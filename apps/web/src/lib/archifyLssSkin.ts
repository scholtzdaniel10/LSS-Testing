/**
 * IG-32: Archify viewer is sandboxed srcdoc — host tokens.css cannot cascade.
 * Inject LSS palette so Map matches the program, not Signal Flow navy/cyan.
 */
export const ARCHIFY_LSS_SKIN_ATTR = 'data-lss-archify-skin';

/** Keep in sync with apps/web/src/theme/tokens.css (dark identity). */
const LSS_TOKENS = `
:root, html {
  --surface-page: #252423;
  --surface-panel: #2a2928;
  --surface-raised: #302e2c;
  --surface-wash: rgba(246, 244, 242, 0.05);
  --ink-1: #f6f4f2;
  --ink-2: #cccac9;
  --ink-3: #85837e;
  --ink-4: #706e69;
  --line-1: #3b3937;
  --line-2: #4a4745;
  --line-3: #625d5b;
  --accent: #ff4b4b;
  --accent-dim: #d34343;
  --series-1: #4584d3;
  --series-2: #678838;
  --series-3: #c256a0;
  --series-4: #8a5bd3;
  --series-other: #706e69;
  --grid-line: #33312f;
}
`;

const ARCHIFY_TO_LSS = `
html[data-theme="dark"],
html[data-theme="light"],
html[data-preset][data-theme="dark"],
html[data-preset][data-theme="light"],
html[data-preset="signal-flow"][data-theme="dark"],
html[data-preset="signal-flow"][data-theme="light"] {
  --bg: var(--surface-page);
  --grid: var(--grid-line);
  --text: var(--ink-1);
  --text-muted: var(--ink-2);
  --text-dim: var(--ink-3);
  --text-faint: var(--ink-4);
  --panel: var(--surface-panel);
  --panel-border: var(--line-1);
  --lane-fill: var(--surface-wash);
  --lane-stroke: var(--line-2);
  --arrow: var(--ink-3);
  --arrow-emphasis: var(--series-1);
  --mask: var(--surface-panel);
  --frontend-fill: color-mix(in srgb, var(--series-1) 18%, transparent);
  --frontend-stroke: var(--series-1);
  --backend-fill: color-mix(in srgb, var(--series-2) 18%, transparent);
  --backend-stroke: var(--series-2);
  --database-fill: color-mix(in srgb, var(--series-4) 18%, transparent);
  --database-stroke: var(--series-4);
  --cloud-fill: color-mix(in srgb, var(--series-3) 16%, transparent);
  --cloud-stroke: var(--series-3);
  --security-fill: color-mix(in srgb, var(--series-3) 16%, transparent);
  --security-stroke: var(--series-3);
  --messagebus-fill: color-mix(in srgb, var(--series-other) 22%, transparent);
  --messagebus-stroke: var(--series-other);
  --external-fill: color-mix(in srgb, var(--series-other) 22%, transparent);
  --external-stroke: var(--series-other);
  --toolbar-bg: color-mix(in srgb, var(--surface-raised) 86%, transparent);
  --toolbar-border: var(--line-2);
  --toolbar-text: var(--ink-1);
  --toolbar-hover: var(--surface-raised);
  --toolbar-menu-bg: var(--surface-raised);
}

html[data-preset="signal-flow"] body,
html[data-preset="signal-flow"][data-theme="light"] body {
  background-color: var(--surface-page);
  background-image: none;
}

html[data-preset="signal-flow"] .diagram-container,
html[data-preset="signal-flow"][data-theme="light"] .diagram-container,
html[data-preset="signal-flow"] .card,
html[data-preset="signal-flow"][data-theme="light"] .card {
  background: var(--surface-panel);
  box-shadow: none;
}

html[data-preset="signal-flow"] .header-row::after {
  color: var(--accent);
  border-color: var(--accent);
  box-shadow: none;
}
`;

export function injectArchifyLssSkin(html: string): string {
  if (html.includes(`${ARCHIFY_LSS_SKIN_ATTR}="1"`)) return html;
  const block = `<style ${ARCHIFY_LSS_SKIN_ATTR}="1">${LSS_TOKENS}${ARCHIFY_TO_LSS}</style>`;
  if (html.includes('</head>')) return html.replace('</head>', `${block}</head>`);
  return `${block}${html}`;
}
