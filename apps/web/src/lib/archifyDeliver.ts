import { renderArchitectureArtifact } from '@lss/archify';
import template from '@lss-archify-template';
import { injectArchifyLssSkin } from './archifyLssSkin';

export function deliverArchitectureHtml(diagram: unknown): { html: string; layoutOk: boolean } {
  const delivered = renderArchitectureArtifact(diagram, template);
  return { ...delivered, html: injectArchifyLssSkin(delivered.html) };
}
