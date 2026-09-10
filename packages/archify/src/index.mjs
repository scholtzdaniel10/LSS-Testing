import { renderArchitectureArtifact } from '../vendor/renderers/architecture/render-architecture.mjs';

export { renderArchitectureArtifact };

export function renderArchitectureHtml(diagram, template, options = {}) {
  const result = renderArchitectureArtifact(diagram, template, options);
  return result.html;
}
