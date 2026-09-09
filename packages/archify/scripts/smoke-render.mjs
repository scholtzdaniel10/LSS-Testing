import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderArchitectureArtifact } from '../src/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const template = fs.readFileSync(path.join(root, 'vendor/assets/template.html'), 'utf8');
const ir = {
  schema_version: 1,
  diagram_type: 'architecture',
  meta: {
    title: 'Demo',
    subtitle: 'rollup fixture',
    visual_preset: 'signal-flow',
    animation: 'trace',
  },
  layout: { mode: 'grid', cols: 4, origin: [40, 80], gapX: 40, gapY: 48, cellW: 140, cellH: 64 },
  components: [
    { id: 'folder_app', type: 'frontend', label: 'app/', sublabel: '2 files', row: 0, col: 0, size: [120, 60] },
    { id: 'folder_lib', type: 'backend', label: 'lib/', sublabel: '2 files', row: 0, col: 1, size: [120, 60] },
  ],
  boundaries: [{ kind: 'region', label: 'Folders', wraps: ['folder_app', 'folder_lib'] }],
  connections: [{ id: 'link_0', from: 'folder_app', to: 'folder_lib', variant: 'emphasis', width: 2 }],
  cards: [{ dot: 'cyan', title: 'Live rollup', items: ['2 folders', '1 route'] }],
};
const result = renderArchitectureArtifact(ir, template);
const checks = {
  htmlBytes: result.html.length,
  layoutOk: result.layoutOk,
  roundedCard: result.html.includes('rx="6"'),
  presentBtn: result.html.includes('btn-present'),
  shareCard: result.html.includes('share-card'),
  preset: result.html.includes('data-preset="signal-flow"'),
};
console.log(JSON.stringify(checks, null, 2));
if (!checks.roundedCard || !checks.presentBtn || !checks.shareCard) process.exit(1);
const out = path.join(root, '../../demo-out');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'archify-exact-map.html'), result.html);
console.log('wrote', path.join(out, 'archify-exact-map.html'));
