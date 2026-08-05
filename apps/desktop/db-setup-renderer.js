'use strict';

/**
 * PLT-14 — renderer script for db-setup.html.
 *
 * Password never enters this page. Main process resolves it from
 * safeStorage / LSS_DB_PASSWORD / DEFAULTS (see main.js resolveCandidate).
 */

(function () {
  const DB_NAME_RE = /^[A-Za-z0-9_]+$/;
  const body = document.body;
  const el = {
    subtitle: document.getElementById('subtitle'),
    host: document.getElementById('host'),
    port: document.getElementById('port'),
    database: document.getElementById('database'),
    username: document.getElementById('username'),
    passwordHint: document.getElementById('password-hint'),
    testBtn: document.getElementById('test-btn'),
    saveBtn: document.getElementById('save-btn'),
    statusError: document.getElementById('status-error'),
    statusSuccess: document.getElementById('status-success'),
    statusIdle: document.getElementById('status-idle'),
  };

  function setState(state) {
    body.setAttribute('data-state', state);
  }

  function setBusy(busy) {
    [el.host, el.port, el.database, el.username, el.testBtn, el.saveBtn].forEach((node) => {
      node.disabled = busy;
    });
  }

  /** Non-secret connection fields only — never password. */
  function readForm() {
    return {
      host: el.host.value.trim(),
      port: Number(el.port.value) || 5432,
      database: el.database.value.trim(),
      username: el.username.value.trim(),
    };
  }

  function showError(message) {
    setState('error');
    el.statusError.textContent = message;
  }

  function validateForm(form) {
    if (!DB_NAME_RE.test(form.database)) {
      return 'Database name may only contain letters, numbers, and underscores.';
    }
    return null;
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
      el.subtitle.textContent = status.isDefault
        ? 'Connect to local Postgres. Password stays in the desktop backend.'
        : 'Update host / database / user. Password stays in the desktop backend.';
      if (el.passwordHint) {
        el.passwordHint.textContent = status.hasPassword
          ? 'A password is already stored encrypted in the main process.'
          : 'Password will use LSS_DB_PASSWORD if set, otherwise the built-in main-process default.';
      }
    } catch (_err) {
      el.host.value = '127.0.0.1';
      el.port.value = '5432';
      el.database.value = 'lss';
      el.username.value = 'lss';
    }

    if (startupError) {
      showError(decodeURIComponent(startupError));
    } else {
      setState('idle');
    }
  }

  el.testBtn.addEventListener('click', async () => {
    const form = readForm();
    const validationError = validateForm(form);
    if (validationError) {
      showError(validationError);
      return;
    }

    setBusy(true);
    setState('loading');
    try {
      const result = await window.lssDesktop.db.test(form);
      setBusy(false);
      if (result.ok) {
        showSuccess(result.message || 'Connection OK.');
      } else {
        showError(result.message || 'Connection failed.');
      }
    } catch (err) {
      setBusy(false);
      showError('Unexpected error: ' + (err && err.message ? err.message : String(err)));
    }
  });

  el.saveBtn.addEventListener('click', async () => {
    const form = readForm();
    const validationError = validateForm(form);
    if (validationError) {
      showError(validationError);
      return;
    }

    setBusy(true);
    setState('loading');
    try {
      const result = await window.lssDesktop.db.save(form);
      if (result.ok) {
        showSuccess('Connected. Migrating and starting the application…');
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
