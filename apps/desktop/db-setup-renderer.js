'use strict';

/**
 * PLT-14 — renderer script for db-setup.html.
 * Runs with contextIsolation on / nodeIntegration off; talks to the main
 * process only through window.lssDesktop.db (see preload.js).
 */

(function () {
  const body = document.body;
  const el = {
    subtitle: document.getElementById('subtitle'),
    host: document.getElementById('host'),
    port: document.getElementById('port'),
    database: document.getElementById('database'),
    username: document.getElementById('username'),
    password: document.getElementById('password'),
    passwordHint: document.getElementById('password-hint'),
    testBtn: document.getElementById('test-btn'),
    saveBtn: document.getElementById('save-btn'),
    statusError: document.getElementById('status-error'),
    statusSuccess: document.getElementById('status-success'),
  };

  function setState(state) {
    body.setAttribute('data-state', state);
  }

  function setBusy(busy) {
    [el.host, el.port, el.database, el.username, el.password, el.testBtn, el.saveBtn].forEach((node) => {
      node.disabled = busy;
    });
  }

  function readForm() {
    return {
      host: el.host.value.trim(),
      port: Number(el.port.value) || 5432,
      database: el.database.value.trim(),
      username: el.username.value.trim(),
      password: el.password.value,
    };
  }

  function showError(message) {
    setState('error');
    el.statusError.textContent = message;
  }

  function showSuccess(message) {
    setState('success');
    el.statusSuccess.textContent = message;
  }

  async function prefill() {
    const params = new URLSearchParams(window.location.search);
    const startupError = params.get('error');

    try {
      const status = await window.lssDesktop.db.getStatus();
      el.host.value = status.host;
      el.port.value = String(status.port);
      el.database.value = status.database;
      el.username.value = status.username;
      el.password.value = status.isDefault ? 'lss' : '';
      el.passwordHint.textContent = status.hasPassword && !status.isDefault
        ? 'Leave blank to keep the saved password.'
        : '';
      el.subtitle.textContent = status.isDefault
        ? 'No saved connection yet — using the default local Postgres (lss/lss/lss).'
        : 'Update your saved local Postgres connection.';
    } catch (_err) {
      // Fall back to hard-coded defaults if the bridge is unavailable for any reason.
      el.host.value = '127.0.0.1';
      el.port.value = '5432';
      el.database.value = 'lss';
      el.username.value = 'lss';
      el.password.value = 'lss';
    }

    if (startupError) {
      showError(decodeURIComponent(startupError));
    } else {
      setState('idle');
    }
  }

  el.testBtn.addEventListener('click', async () => {
    setBusy(true);
    setState('loading');
    try {
      const result = await window.lssDesktop.db.test(readForm());
      setBusy(false);
      if (result.ok) {
        showSuccess('Connection OK.');
      } else {
        showError(result.message || 'Connection failed.');
      }
    } catch (err) {
      setBusy(false);
      showError('Unexpected error: ' + (err && err.message ? err.message : String(err)));
    }
  });

  el.saveBtn.addEventListener('click', async () => {
    setBusy(true);
    setState('loading');
    try {
      const result = await window.lssDesktop.db.save(readForm());
      if (result.ok) {
        showSuccess('Connected. Migrating and starting the application…');
        // Main process navigates this window to the app once the sidecar is healthy.
      } else {
        setBusy(false);
        showError(result.message || 'Could not save and start.');
      }
    } catch (err) {
      setBusy(false);
      showError('Unexpected error: ' + (err && err.message ? err.message : String(err)));
    }
  });

  prefill();
})();
