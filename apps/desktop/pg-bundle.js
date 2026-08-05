'use strict';

/**
 * DSK-9 prototype — bundled Postgres child for seamless Tier 1 first-run.
 *
 * Uses the `embedded-postgres` npm package (downloads platform binaries on
 * first initialise). Data lives under Electron userData/pgdata — never in the
 * repo. Listens on 127.0.0.1 only at a dedicated port (default 55432) so it
 * does not clash with a system Postgres on 5432.
 *
 * This is a prototype for UX + lifecycle; production DSK-9 may switch to
 * officially vendored binaries in electron-builder extraResources.
 */

const path = require('path');
const { app } = require('electron');

const BUNDLED_DEFAULTS = Object.freeze({
  host: '127.0.0.1',
  port: 55432,
  database: 'lss',
  username: 'lss',
  password: 'lss',
});

/** @type {import('embedded-postgres').default | null} */
let instance = null;
let started = false;

function dataDir() {
  return path.join(app.getPath('userData'), 'pgdata-prototype');
}

function connectionConfig() {
  return { ...BUNDLED_DEFAULTS };
}

/**
 * Start (or reuse) the bundled Postgres. First call may download binaries
 * and run initdb — can take tens of seconds.
 *
 * @param {(msg: string) => void} [onProgress]
 * @returns {Promise<{ ok: true, config: object } | { ok: false, message: string }>}
 */
async function startBundledPostgres(onProgress) {
  const report = typeof onProgress === 'function' ? onProgress : () => {};

  if (started && instance) {
    return { ok: true, config: connectionConfig() };
  }

  let EmbeddedPostgres;
  try {
    // CJS interop — package default-exports the class.
    const mod = require('embedded-postgres');
    EmbeddedPostgres = mod.default || mod;
  } catch (err) {
    return {
      ok: false,
      message:
        'Bundled Postgres prototype package is missing.\n\n' +
        'From apps/desktop run: npm install\n\n' +
        (err && err.message ? err.message : String(err)),
    };
  }

  try {
    report('Preparing built-in database…');
    const cfg = connectionConfig();
    instance = new EmbeddedPostgres({
      databaseDir: dataDir(),
      user: cfg.username,
      password: cfg.password,
      port: cfg.port,
      persistent: true,
      // Keep init quiet; progress goes through onProgress.
      initdbFlags: ['--auth=scram-sha-256'],
    });

    report('Initialising data directory (first run only)…');
    await instance.initialise();

    report('Starting built-in Postgres…');
    await instance.start();
    started = true;

    report('Ensuring database "' + cfg.database + '" exists…');
    try {
      await instance.createDatabase(cfg.database);
    } catch (_err) {
      // Already exists is fine on subsequent launches.
    }

    report('Built-in database is ready.');
    return { ok: true, config: cfg };
  } catch (err) {
    instance = null;
    started = false;
    return {
      ok: false,
      message:
        'Could not start the built-in Postgres prototype:\n\n' +
        (err && err.message ? err.message : String(err)),
    };
  }
}

async function stopBundledPostgres() {
  if (!instance || !started) {
    instance = null;
    started = false;
    return;
  }
  try {
    await instance.stop();
  } catch (_err) {
    // Best-effort on quit.
  }
  instance = null;
  started = false;
}

function isRunning() {
  return started;
}

module.exports = {
  BUNDLED_DEFAULTS,
  connectionConfig,
  startBundledPostgres,
  stopBundledPostgres,
  isRunning,
  dataDir,
};
