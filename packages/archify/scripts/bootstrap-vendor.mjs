/**
 * One-shot copy of the architecture-only Archify subset (MIT).
 * Source: C:\\LSS\\tmp-archify  (git clone of tt-a1i/archify).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const destRoot = path.resolve(here, '..');
const srcRoot = process.argv[2] || 'C:\\LSS\\tmp-archify';

const copies = [
  ['LICENSE', 'LICENSE'],
  ['archify/LICENSE', 'vendor/LICENSE'],
  ['archify/assets/template.html', 'vendor/assets/template.html'],
  ['archify/assets/JetBrainsMono-OFL.txt', 'vendor/assets/JetBrainsMono-OFL.txt'],
  ['archify/schemas/architecture.schema.json', 'vendor/schemas/architecture.schema.json'],
  ['archify/schemas/common.schema.json', 'vendor/schemas/common.schema.json'],
  ['archify/renderers/architecture/grid.mjs', 'vendor/renderers/architecture/grid.mjs'],
  ['archify/renderers/shared/utils.mjs', 'vendor/renderers/shared/utils.mjs'],
  ['archify/renderers/shared/geometry.mjs', 'vendor/renderers/shared/geometry.mjs'],
  ['archify/renderers/shared/legend.mjs', 'vendor/renderers/shared/legend.mjs'],
  ['archify/renderers/shared/text-fit.mjs', 'vendor/renderers/shared/text-fit.mjs'],
  ['archify/renderers/shared/i18n.mjs', 'vendor/renderers/shared/i18n.mjs'],
  ['archify/renderers/shared/desktop-readability.mjs', 'vendor/renderers/shared/desktop-readability.mjs'],
  ['archify/renderers/shared/layout-report.mjs', 'vendor/renderers/shared/layout-report.mjs'],
];

for (const [from, to] of copies) {
  const src = path.join(srcRoot, from);
  const dest = path.join(destRoot, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log('copied', to, fs.statSync(dest).size);
}

const rendererSrc = fs.readFileSync(
  path.join(srcRoot, 'archify/renderers/architecture/render-architecture.mjs'),
  'utf8',
);

let renderer = rendererSrc
  .replace(
    `import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, renderSemanticSigil, textUnits } from '../shared/utils.mjs';
import { animateAttr, focusEdgeAttrs, focusNodeAttrs, focusNodeTitle, loadDiagramWithBrandMarks, writeDiagram, svgAccessibleText, svgRootAttrs } from '../shared/cli.mjs';
`,
    `import { esc, renderDefinitions, renderSemanticSigil, textUnits, applyTemplate, renderCards } from '../shared/utils.mjs';
import { animateAttr, focusEdgeAttrs, focusNodeAttrs, focusNodeTitle, svgAccessibleText, svgRootAttrs } from '../shared/cli.mjs';
`,
  )
  .replace(
    `const __dirname = path.dirname(fileURLToPath(import.meta.url));
const layoutJsonMode = process.argv.includes('--layout-json');
const cliArgs = process.argv.filter((arg) => arg !== '--layout-json');
const { diagram: arch, template, outPath, sourceEvidence } = await loadDiagramWithBrandMarks({
  rendererDir: __dirname,
  diagramType: 'architecture',
  defaultExample: 'web-app.architecture.json',
  argv: cliArgs,
});
`,
    `export function renderArchitectureArtifact(arch, template, options = {}) {
`,
  )
  .replace(
    `validateArchitecture();
if (layoutJsonMode) {
  console.log(JSON.stringify(buildLayoutReport(), null, 2));
  process.exit(0);
}
writeDiagram({
  outPath,
  template,
  diagramType: 'architecture',
  meta: arch.meta,
  svg: renderSvg(),
  cards: arch.cards,
  sourceEvidence,
});
`,
    `  let layoutOk = true;
  try {
    validateArchitecture();
  } catch (error) {
    if (options.strict) throw error;
    layoutOk = false;
  }
  const html = applyTemplate(template, {
    title: arch.meta.title,
    subtitle: arch.meta.subtitle,
    svg: renderSvg(),
    cards: renderCards(arch.cards),
    locale: arch.meta.locale,
    visualPreset: arch.meta.visual_preset || 'classic',
    guidedViews: arch.meta.views || [],
    sourceEvidence: null,
  });
  return { html, layoutOk };
}
`,
  );

if (renderer.includes('loadDiagramWithBrandMarks') || renderer.includes('writeDiagram') || renderer.includes('node:path')) {
  throw new Error('renderer transform did not strip CLI entry');
}
if (!renderer.includes('export function renderArchitectureArtifact')) {
  throw new Error('renderer transform missed export');
}

fs.writeFileSync(
  path.join(destRoot, 'vendor/renderers/architecture/render-architecture.mjs'),
  renderer,
);
console.log('wrote wrapped renderer', renderer.length);
