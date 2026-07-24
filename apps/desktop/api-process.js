'use strict';

/**
 * PLT-14 — spawns/probes the Laravel API sidecar for the self-contained
 * desktop launch path (portable-exe users with no desktop.bat).
 *
 * The API bind stays 127.0.0.1-only (Laravel's `artisan serve` default,
 * made explicit here via --host). The user's Postgres is reached by the
 * sidecar as an *outbound* connection only — nothing here opens a
 * non-loopback listener.
 */

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const API_DIR = path.resolve(__dirname, '..', 'api');

// Postgres identifiers we're willing to CREATE DATABASE for. Deliberately
// restrictive: rather than trying to correctly quote/escape exotic
// identifiers (spaces, quotes, unicode), we just refuse them with a clear
// message. This also gates what the desktop UI will ever persist as a
// database name.
const DB_NAME_RE = /^[A-Za-z0-9_]+$/;

function isValidDatabaseName(name) {
  return typeof name === 'string' && DB_NAME_RE.test(name);
}

/** True if `output` (artisan stdout+stderr) looks like Postgres SQLSTATE 3D000 ("database does not exist"). */
function isMissingDatabaseError(output) {
  return /database\s+"?[\w-]+"?\s+does not exist/i.test(String(output || ''));
}

// One-shot PDO script run via `php -r`. Connects to the `postgres`
// maintenance database (always present) and CREATEs the target database.
// The identifier is passed through an env var (not argv, so it never shows
// up in a process listing) and re-validated here in PHP as defense in depth
// even though the caller already checked it against DB_NAME_RE.
const CREATE_DB_PHP_SNIPPET = `
$host = getenv('LSS_PGHOST');
$port = getenv('LSS_PGPORT');
$user = getenv('LSS_PGUSER');
$pass = getenv('LSS_PGPASSWORD');
$db = getenv('LSS_PGDBNAME');
if (!preg_match('/^[A-Za-z0-9_]+$/', (string) $db)) {
    fwrite(STDERR, "Invalid database name.\n");
    exit(2);
}
try {
    $dsn = sprintf('pgsql:host=%s;port=%s;dbname=postgres', $host, $port);
    $pdo = new PDO($dsn, $user, $pass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 10]);
    $pdo->exec('CREATE DATABASE "' . $db . '"');
    echo "CREATED\n";
} catch (PDOException $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}
`;

/** Must exceed longest queued job timeout (AnalyzeProject = 660s). */
const QUEUE_LISTEN_TIMEOUT_SEC = 660;

/** Builds the DB_* + session/cache env block injected into PHP child processes. */
function buildDbEnv(dbConfig) {
  return {
    DB_CONNECTION: 'pgsql',
    DB_HOST: dbConfig.host,
    DB_PORT: String(dbConfig.port),
    DB_DATABASE: dbConfig.database,
    DB_USERNAME: dbConfig.username,
    DB_PASSWORD: dbConfig.password,
    SESSION_DRIVER: 'file',
    CACHE_STORE: 'file',
  };
}

/**
 * Runs a one-shot `php artisan <args>` in apps/api with extraEnv merged over
 * the current process env (Laravel's Dotenv does not override env vars that
 * are already set, so this takes effect without touching any .env file).
 * Resolves (never rejects) with { code, stdout, stderr, timedOut?, spawnError? }.
 */
function runArtisan(args, extraEnv, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('php', ['artisan', ...args], {
        cwd: API_DIR,
        env: Object.assign({}, process.env, extraEnv),
        windowsHide: true,
      });
    } catch (err) {
      resolve({ code: null, stdout: '', stderr: err.message, spawnError: err });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ code: null, stdout, stderr: stderr + '\n[timed out after ' + timeoutMs + 'ms]', timedOut: true });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + '\n' + err.message, spawnError: err });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** Polls `url` until it returns HTTP 200 or timeoutMs elapses. Resolves boolean. */
function waitForHealth(url, timeoutMs = 20000, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          scheduleRetry();
        }
      });
      req.on('error', scheduleRetry);
      req.setTimeout(intervalMs, () => {
        req.destroy();
        scheduleRetry();
      });
    };

    const scheduleRetry = () => {
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      setTimeout(attempt, intervalMs);
    };

    attempt();
  });
}

/**
 * Spawns the long-running `php artisan serve` sidecar bound to host:port with
 * extraEnv merged in. Returns the ChildProcess; caller owns its lifetime
 * (kill on app quit / config change).
 */
function spawnApiServer(host, port, extraEnv) {
  return spawn(
    'php',
    [
      '-d', 'upload_max_filesize=512M',
      '-d', 'post_max_size=512M',
      'artisan', 'serve',
      '--host=' + host,
      '--port=' + String(port),
    ],
    {
      cwd: API_DIR,
      env: Object.assign({}, process.env, extraEnv),
      windowsHide: true,
    },
  );
}

/**
 * Spawns `php artisan queue:listen` with the same env as the API sidecar.
 * Caller owns lifetime (kill on app quit / API restart).
 */
function spawnQueueWorker(extraEnv) {
  return spawn(
    'php',
    [
      'artisan', 'queue:listen',
      '--timeout=' + String(QUEUE_LISTEN_TIMEOUT_SEC),
    ],
    {
      cwd: API_DIR,
      env: Object.assign({}, process.env, extraEnv),
      windowsHide: true,
    },
  );
}

/**
 * Attempts `CREATE DATABASE` for cfg.database against cfg's Postgres server,
 * connecting to the `postgres` maintenance database. Idempotent: an
 * "already exists" error is treated as success (created: false), since the
 * goal is "make sure it exists", not "create it fresh".
 * Resolves { ok: true, created: boolean } or { ok: false, message }.
 * Credentials are passed to the PHP child via env vars, never argv.
 */
function ensureDatabaseExists(cfg) {
  return new Promise((resolve) => {
    if (!isValidDatabaseName(cfg.database)) {
      resolve({ ok: false, message: 'Database name may only contain letters, numbers, and underscores.' });
      return;
    }

    const env = Object.assign({}, process.env, {
      LSS_PGHOST: String(cfg.host),
      LSS_PGPORT: String(cfg.port),
      LSS_PGUSER: cfg.username,
      LSS_PGPASSWORD: cfg.password,
      LSS_PGDBNAME: cfg.database,
    });

    let child;
    try {
      child = spawn('php', ['-r', CREATE_DB_PHP_SNIPPET], { env, windowsHide: true });
    } catch (err) {
      resolve({ ok: false, message: err.message });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeoutMs = 15000;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ ok: false, message: 'Timed out trying to create the database. Check host/port and that Postgres is reachable.' });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, message: err.message });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ ok: true, created: true });
        return;
      }
      if (/already exists/i.test(stderr)) {
        resolve({ ok: true, created: false });
        return;
      }
      resolve({ ok: false, message: interpretDbError(stderr + '\n' + stdout) });
    });
  });
}

/** Turns raw artisan stdout/stderr into a short, real, human-readable error message. */
function interpretDbError(output) {
  const text = String(output || '').trim();

  if (/could not connect to server|connection refused|no connection could be made/i.test(text)) {
    return 'Could not reach the database server. Check that Postgres is running and the host/port are correct.\n\n' + tail(text);
  }
  if (/password authentication failed/i.test(text)) {
    return 'Authentication failed. Check the username and password.\n\n' + tail(text);
  }
  if (/permission denied to create database|must be owner|must be superuser/i.test(text)) {
    return 'This user is not allowed to create databases. Ask a database administrator to grant CREATEDB, or create the database yourself.\n\n' + tail(text);
  }
  if (isMissingDatabaseError(text)) {
    return 'The database does not exist on that server yet. It will be created automatically when you click Save & start.\n\n' + tail(text);
  }
  if (/timed out/i.test(text)) {
    return 'Timed out waiting for a response. Check host/port and that Postgres is reachable.\n\n' + tail(text);
  }
  return tail(text) || 'Unknown error — see details above.';
}

function tail(text, maxLen = 600) {
  if (text.length <= maxLen) return text;
  return '…' + text.slice(text.length - maxLen);
}

module.exports = {
  API_DIR,
  QUEUE_LISTEN_TIMEOUT_SEC,
  buildDbEnv,
  runArtisan,
  waitForHealth,
  spawnApiServer,
  spawnQueueWorker,
  interpretDbError,
  isValidDatabaseName,
  isMissingDatabaseError,
  ensureDatabaseExists,
};
