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
    subtitle: 'live rollup → signal flow',
    visual_preset: 'signal-flow',
    quality_profile: 'showcase',
    animation: 'trace',
  },
  layout: { mode: 'grid', cols: 4, origin: [56, 96], gapX: 64, gapY: 56, cellW: 140, cellH: 64 },
  components: [
    { id: 'folder_app', type: 'frontend', label: 'app/', sublabel: '120 files', row: 1, col: 0, size: [140, 64] },
    { id: 'folder_src', type: 'backend', label: 'src/', sublabel: '90 files', row: 0, col: 1, size: [140, 64] },
    { id: 'folder_routes', type: 'frontend', label: 'routes/', sublabel: '28 files', row: 1, col: 1, size: [140, 64] },
    { id: 'folder_resources', type: 'frontend', label: 'resources/', sublabel: '12 files', row: 2, col: 1, size: [140, 64] },
    { id: 'folder_lib', type: 'backend', label: 'lib/', sublabel: '45 files', row: 0, col: 2, size: [140, 64] },
    { id: 'folder_database', type: 'database', label: 'database/', sublabel: '22 files', row: 1, col: 2, size: [140, 64] },
    { id: 'folder_config', type: 'cloud', label: 'config/', sublabel: '8 files', row: 2, col: 2, size: [140, 64] },
    { id: 'folder_tests', type: 'security', label: 'tests/', sublabel: '18 files', row: 0, col: 3, size: [140, 64] },
  ],
  boundaries: [],
  connections: [
    { id: 'link_0', from: 'folder_app', to: 'folder_src', variant: 'emphasis', width: 3, fromSide: 'right', toSide: 'left', route: 'orthogonal-h' },
    { id: 'link_1', from: 'folder_src', to: 'folder_lib', variant: 'default', width: 2, fromSide: 'right', toSide: 'left', route: 'orthogonal-h' },
    { id: 'link_2', from: 'folder_app', to: 'folder_routes', variant: 'default', width: 1, fromSide: 'right', toSide: 'left', route: 'orthogonal-h' },
    { id: 'link_3', from: 'folder_src', to: 'folder_database', variant: 'emphasis', width: 2, fromSide: 'right', toSide: 'left', route: 'orthogonal-h' },
    { id: 'link_4', from: 'folder_lib', to: 'folder_tests', variant: 'dashed', width: 1, fromSide: 'right', toSide: 'left', route: 'orthogonal-h' },
    { id: 'link_5', from: 'folder_routes', to: 'folder_config', variant: 'default', width: 1, fromSide: 'right', toSide: 'left', route: 'orthogonal-h' },
    { id: 'link_6', from: 'folder_app', to: 'folder_resources', variant: 'default', width: 1, fromSide: 'right', toSide: 'left', route: 'orthogonal-h' },
  ],
  cards: [
    { dot: 'cyan', title: 'Rollup', items: ['8 folder cards', '7 routes from payload links'] },
    { dot: 'emerald', title: 'Live data', items: ['Map mount uses graph/rollup only', 'No invented edges'] },
    { dot: 'rose', title: 'Health', items: ['No folder errors in view'] },
  ],
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
if (!checks.layoutOk || !checks.roundedCard || !checks.presentBtn || !checks.shareCard) process.exit(1);
const out = path.join(root, '../../demo-out');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'archify-exact-map.html'), result.html);
console.log('wrote', path.join(out, 'archify-exact-map.html'));
