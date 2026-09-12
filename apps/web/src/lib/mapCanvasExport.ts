/**
 * IG-32: export the live Map SVG as a PNG share card.
 * Inlines computed token colours so CSS variables survive rasterisation.
 */

export const MAP_EXPORT_FILENAME = 'lss-map.png';

const COPYABLE = ['fill', 'stroke', 'stroke-width', 'stroke-opacity', 'fill-opacity', 'opacity', 'font-size', 'font-family', 'font-weight'] as const;

function computedSurface(svg: SVGSVGElement): string {
  const host = svg.parentElement;
  const fromHost = host ? getComputedStyle(host).backgroundColor : '';
  if (fromHost && fromHost !== 'rgba(0, 0, 0, 0)' && fromHost !== 'transparent') return fromHost;
  const token = getComputedStyle(document.documentElement).getPropertyValue('--surface-panel').trim();
  if (token) return token;
  const page = getComputedStyle(svg).backgroundColor;
  return page && page !== 'rgba(0, 0, 0, 0)' ? page : 'var(--surface-panel)';
}

function inlineComputedSvg(svg: SVGSVGElement): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const srcEls = [svg, ...Array.from(svg.querySelectorAll('*'))];
  const dstEls = [clone, ...Array.from(clone.querySelectorAll('*'))];
  for (let i = 0; i < srcEls.length; i++) {
    const src = srcEls[i];
    const dst = dstEls[i];
    if (!(src instanceof Element) || !(dst instanceof Element)) continue;
    const cs = getComputedStyle(src);
    for (const prop of COPYABLE) {
      const value = cs.getPropertyValue(prop);
      if (value) dst.setAttribute(prop, value.trim());
    }
    if (src instanceof SVGTextElement || src instanceof SVGTSpanElement) {
      dst.setAttribute('fill', cs.fill);
    }
  }

  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', computedSurface(svg));
  clone.insertBefore(bg, clone.firstChild);
  return clone;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function svgToPngBlob(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const inlined = inlineComputedSvg(svg);
  const xml = new XMLSerializer().serializeToString(inlined);
  const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not rasterise the map.'));
      img.src = url;
    });
    const w = Math.max(1, svg.clientWidth || svg.viewBox.baseVal.width || 1400);
    const h = Math.max(1, svg.clientHeight || svg.viewBox.baseVal.height || 400);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not export the map.');
    ctx.fillStyle = computedSurface(svg);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not export the map.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function copyOrDownloadPng(
  blob: Blob,
  filename = MAP_EXPORT_FILENAME,
): Promise<'clipboard' | 'download'> {
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return 'clipboard';
    }
  } catch {
    // Clipboard image writes are often blocked; download is the designed fallback.
  }
  downloadBlob(blob, filename);
  return 'download';
}

export async function exportMapSvg(svg: SVGSVGElement): Promise<'clipboard' | 'download'> {
  const blob = await svgToPngBlob(svg);
  return copyOrDownloadPng(blob);
}

function tokenColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function paintShareCard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  opts: { title?: string; subtitle?: string },
): void {
  const title = opts.title?.trim();
  const subtitle = opts.subtitle?.trim();
  if (!title && !subtitle) return;
  const band = Math.max(44, Math.round(height * 0.08));
  ctx.fillStyle = tokenColor('--surface-raised', 'var(--surface-raised)');
  ctx.fillRect(0, 0, width, band);
  ctx.fillStyle = tokenColor('--line-1', 'var(--line-1)');
  ctx.fillRect(0, band - 1, width, 1);
  const pad = Math.max(16, Math.round(width * 0.02));
  ctx.fillStyle = tokenColor('--ink-1', 'var(--ink-1)');
  ctx.font = `600 ${Math.round(band * 0.32)}px ${tokenColor('--font-sans', 'sans-serif')}`;
  ctx.textBaseline = 'middle';
  if (title) ctx.fillText(title, pad, band / 2 - (subtitle ? 6 : 0), width - pad * 2);
  if (subtitle) {
    ctx.fillStyle = tokenColor('--ink-3', 'var(--ink-3)');
    ctx.font = `400 ${Math.round(band * 0.24)}px ${tokenColor('--font-mono', 'monospace')}`;
    ctx.fillText(subtitle, pad, band / 2 + 10, width - pad * 2);
  }
}

/** Current map view as PNG; clipboard when allowed, otherwise download. */
export async function exportMapPng(
  svg: SVGSVGElement,
  opts?: { title?: string; subtitle?: string },
): Promise<'copied' | 'download'> {
  const blob = await svgToPngBlob(svg);
  if ((opts?.title || opts?.subtitle) && typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not export the map.');
    ctx.drawImage(bitmap, 0, 0);
    paintShareCard(ctx, canvas.width, canvas.height, opts);
    const branded = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!branded) throw new Error('Could not export the map.');
    const mode = await copyOrDownloadPng(branded);
    return mode === 'clipboard' ? 'copied' : 'download';
  }
  const mode = await copyOrDownloadPng(blob);
  return mode === 'clipboard' ? 'copied' : 'download';
}
