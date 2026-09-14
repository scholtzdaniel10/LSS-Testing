import { describe, expect, it } from 'vitest';
import {
  ARCHIFY_IFRAME_SANDBOX,
  injectArchifyHost,
  isArchifyFrameMessage,
} from './archifyHost';

describe('Archify iframe host isolation', () => {
  it('does not grant the viewer same-origin access to the LSS app', () => {
    expect(ARCHIFY_IFRAME_SANDBOX).toContain('allow-scripts');
    expect(ARCHIFY_IFRAME_SANDBOX).not.toContain('allow-same-origin');
  });

  it('embeds the gallery diagram on Map overview and Present on the stage', () => {
    const markup = '<html lang="en" data-theme="dark" data-preset="signal-flow"><body>ok</body></html>';
    const overview = injectArchifyHost(markup, false);
    expect(overview).toContain('data-embed="true"');
    expect(overview).not.toContain('data-present="true"');
    expect(overview).toContain('data-lss-archify-host="1"');

    const present = injectArchifyHost(markup, true);
    expect(present).toContain('data-present="true"');
    expect(present).not.toContain('data-embed="true"');
    expect(present).toContain('lss-archify');
  });

  it('accepts node-click only from the iframe window', () => {
    const frame = {} as Window;
    const good = {
      source: frame,
      data: { source: 'lss-archify', type: 'node-click', id: 'folder_app' },
    } as MessageEvent;
    const other = {
      source: {} as Window,
      data: { source: 'lss-archify', type: 'node-click', id: 'folder_app' },
    } as MessageEvent;
    expect(isArchifyFrameMessage(good, frame)).toBe(true);
    expect(isArchifyFrameMessage(other, frame)).toBe(false);
  });
});
