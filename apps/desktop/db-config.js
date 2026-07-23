'use strict';

/**
 * PLT-14 — local Postgres connection config for portable-exe users.
 *
 * The config (host/port/database/username/password) is stored as JSON in
 * Electron's per-user `userData` directory — never inside the repo/app
 * directory, and never written into any `.env` file. The password is
 * encrypted at rest with Electron `safeStorage` when the OS keychain/DPAPI
 * backend is available; otherwise it is stored plaintext with an explicit
 * `encrypted: false` flag so callers/UI can surface that fact.
 */

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const CONFIG_FILE_NAME = 'db-config.json';

const DEFAULTS = Object.freeze({
  host: '127.0.0.1',
  port: 5432,
  database: 'lss',
  username: 'lss',
  password: 'lss',
});

function configPath() {
  return path.join(app.getPath('userData'), CONFIG_FILE_NAME);
}

function encryptPassword(plain) {
  const text = plain || '';
  if (safeStorage.isEncryptionAvailable()) {
    return { password: safeStorage.encryptString(text).toString('base64'), encrypted: true };
  }
  return { password: text, encrypted: false };
}

function decryptPassword(stored, encrypted) {
  if (!stored) return '';
  if (!encrypted) return stored;
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'));
  } catch (_err) {
    // Undecryptable (e.g. config copied to another machine/user) — treat as unset.
    return '';
  }
}

function readRawConfig() {
  const file = configPath();
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_err) {
    return null;
  }
}

/**
 * loadConfig() -> { host, port, database, username, password, isDefault, encrypted }
 *
 * `password` is decrypted in-memory only for this process; it is never
 * re-serialised anywhere except back through saveConfig()'s own encryption.
 * When no config file exists yet, returns the documented defaults with
 * `isDefault: true`.
 */
function loadConfig() {
  const raw = readRawConfig();
  if (!raw) {
    return { ...DEFAULTS, isDefault: true, encrypted: false };
  }
  return {
    host: raw.host || DEFAULTS.host,
    port: Number(raw.port) || DEFAULTS.port,
    database: raw.database || DEFAULTS.database,
    username: raw.username || DEFAULTS.username,
    password: decryptPassword(raw.password, raw.encrypted !== false),
    isDefault: false,
    encrypted: raw.encrypted !== false,
  };
}

/**
 * saveConfig(cfg) — persists host/port/database/username/password to the
 * userData JSON file, encrypting the password when possible. Returns the
 * normalised, decrypted-in-memory config (same shape as loadConfig()).
 */
function saveConfig(cfg) {
  const normalised = {
    host: (cfg.host || DEFAULTS.host).trim(),
    port: Number(cfg.port) || DEFAULTS.port,
    database: (cfg.database || DEFAULTS.database).trim(),
    username: (cfg.username || DEFAULTS.username).trim(),
  };
  const { password, encrypted } = encryptPassword(cfg.password || '');

  const dir = path.dirname(configPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    configPath(),
    JSON.stringify({ ...normalised, password, encrypted }, null, 2),
    { mode: 0o600 },
  );

  return { ...normalised, password: cfg.password || '', isDefault: false, encrypted };
}

/**
 * maskConfig(cfg) — the only shape ever sent to the renderer: never the raw
 * password, just whether one is set, so the settings UI can pre-fill safe
 * fields and show a "leave blank to keep saved password" placeholder.
 */
function maskConfig(cfg) {
  return {
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    username: cfg.username,
    hasPassword: Boolean(cfg.password),
    isDefault: Boolean(cfg.isDefault),
    encrypted: Boolean(cfg.encrypted),
  };
}

module.exports = { DEFAULTS, loadConfig, saveConfig, maskConfig, configPath };
