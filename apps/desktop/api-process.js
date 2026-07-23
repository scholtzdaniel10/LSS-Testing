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

/** Builds the DB_* + SESSION_DRIVER env block injected into the PHP child process. */
function buildDbEnv(dbConfig) {
  return {
    DB_CONNECTION: 'pgsql',
    DB_HOST: dbConfig.host,
    DB_PORT: String(dbConfig.port),
    DB_DATABASE: dbConfig.database,
    DB_USERNAME: dbConfig.username,
    DB_PASSWORD: dbConfig.password,
    SESSION_DRIVER: 'file',
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

/** Turns raw artisan stdout/stderr into a short, real, human-readable error message. */
function interpretDbError(output) {
  const text = String(output || '').trim();

  if (/could not connect to server|connection refused|no connection could be made/i.test(text)) {
    return 'Could not reach the database server. Check that Postgres is running and the host/port are correct.\n\n' + tail(text);
  }
  if (/password authentication failed/i.test(text)) {
    return 'Authentication failed. Check the username and password.\n\n' + tail(text);
  }
  if (/database\s+"?[\w-]+"?\s+does not exist/i.test(text)) {
    return 'The database does not exist on that server. Check the database name.\n\n' + tail(text);
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
  buildDbEnv,
  runArtisan,
  waitForHealth,
  spawnApiServer,
  interpretDbError,
};
