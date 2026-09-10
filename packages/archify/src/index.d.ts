export function renderArchitectureHtml(
  diagram: unknown,
  template: string,
  options?: { strict?: boolean },
): string;

export function renderArchitectureArtifact(
  diagram: unknown,
  template: string,
  options?: { strict?: boolean },
): { html: string; layoutOk: boolean };
