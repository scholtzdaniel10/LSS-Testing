import { renderArchitectureArtifact } from '@lss/archify';
import template from '@lss-archify-template';

export function deliverArchitectureHtml(diagram: unknown): { html: string; layoutOk: boolean } {
  return renderArchitectureArtifact(diagram, template);
}
