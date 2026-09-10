/**
 * Host bridge for the Archify iframe. Imported program names are hostile
 * data — the viewer must not run same-origin with the LSS app.
 */

export const ARCHIFY_IFRAME_SANDBOX = 'allow-scripts allow-downloads';
export const ARCHIFY_HOST_SOURCE = 'lss-host';
export const ARCHIFY_FRAME_SOURCE = 'lss-archify';

export type ArchifyFrameMessage =
  | { source: typeof ARCHIFY_FRAME_SOURCE; type: 'ready' }
  | { source: typeof ARCHIFY_FRAME_SOURCE; type: 'node-click'; id: string };

export type ArchifyHostMessage =
  | { source: typeof ARCHIFY_HOST_SOURCE; type: 'present'; on: boolean }
  | { source: typeof ARCHIFY_HOST_SOURCE; type: 'export-share-card' };

const BRIDGE_SCRIPT = `<script data-lss-archify-host="1">
(function () {
  var FRAME = ${JSON.stringify(ARCHIFY_FRAME_SOURCE)};
  var HOST = ${JSON.stringify(ARCHIFY_HOST_SOURCE)};
  function send(payload) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(Object.assign({ source: FRAME }, payload), '*');
    }
  }
  function applyPresent(on) {
    var stage = window.Archify && window.Archify.presentation;
    if (!stage) return false;
    if (on && !stage.active()) stage.enter();
    if (!on && stage.active()) stage.exit();
    return true;
  }
  var pendingPresent = null;
  document.addEventListener('click', function (ev) {
    var node = ev.target && ev.target.closest && ev.target.closest('[data-node-id]');
    if (!node) return;
    var id = node.getAttribute('data-node-id');
    if (id) send({ type: 'node-click', id: id });
  });
  window.addEventListener('message', function (ev) {
    if (!ev.data || ev.data.source !== HOST) return;
    if (ev.data.type === 'present') {
      pendingPresent = Boolean(ev.data.on);
      applyPresent(pendingPresent);
    }
    if (ev.data.type === 'export-share-card') {
      var btn = document.querySelector('button[data-format="share-card"]');
      if (btn) btn.click();
    }
  });
  function ready() {
    send({ type: 'ready' });
    if (pendingPresent !== null) applyPresent(pendingPresent);
  }
  if (document.readyState === 'complete') ready();
  else window.addEventListener('load', ready);
})();
</script>`;

export function injectArchifyHost(html: string, present: boolean): string {
  const flags = present ? ' data-present="true"' : ' data-embed="true"';
  const out = html.replace(
    /<html lang="([^"]*)" data-theme="dark" data-preset="([^"]*)">/,
    `<html lang="$1" data-theme="dark" data-preset="$2"${flags}>`,
  );
  if (out.includes('data-lss-archify-host="1"')) return out;
  if (out.includes('</body>')) return out.replace('</body>', `${BRIDGE_SCRIPT}</body>`);
  return `${out}${BRIDGE_SCRIPT}`;
}

export function isArchifyFrameMessage(
  event: MessageEvent,
  frameWindow: Window | null | undefined,
): event is MessageEvent<ArchifyFrameMessage> {
  if (!frameWindow || event.source !== frameWindow) return false;
  const data = event.data;
  if (!data || typeof data !== 'object' || data.source !== ARCHIFY_FRAME_SOURCE) return false;
  if (data.type === 'ready') return true;
  return data.type === 'node-click' && typeof data.id === 'string' && data.id.length > 0;
}

export function postToArchifyFrame(
  frameWindow: Window | null | undefined,
  message: ArchifyHostMessage,
): void {
  frameWindow?.postMessage(message, '*');
}
