/**
 * IG-32: Explore Map host for Archify architecture HTML.
 * Live rollup → architecture IR → vendored Archify renderer → iframe.
 * First paint never paints hub-dot circles.
 */

import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import type { GraphOverview, GraphRollup } from '../api/client';
import type { RollupPaintMeta } from '../lib/rollupMapModel';
import { rollupToArchifyIR } from '../lib/rollupToArchify';
import { deliverArchitectureHtml } from '../lib/archifyDeliver';

export type RollupMapProps = {
  rollup: GraphRollup;
  meta?: RollupPaintMeta;
  focusParam: string | null;
  neighbourhood?: GraphOverview | null;
  drillFocus?: string | null;
  onHubClick?: (id: string) => void;
  projectName?: string | null;
  present?: boolean;
};

type ArchifyWindow = Window & {
  Archify?: {
    presentation?: {
      enter: () => void;
      exit: () => void;
      toggle: () => void;
      active: () => boolean;
    };
  };
};

function injectViewerFlags(html: string, present: boolean): string {
  const flags = present ? ' data-present="true"' : '';
  return html.replace(
    /<html lang="([^"]*)" data-theme="dark" data-preset="([^"]*)">/,
    `<html lang="$1" data-theme="dark" data-preset="$2"${flags}>`,
  );
}

const RollupMap: React.FC<RollupMapProps> = ({
  rollup,
  meta,
  neighbourhood = null,
  drillFocus = null,
  onHubClick,
  projectName,
  present = false,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const presentOnCreate = useRef(present);
  const reducedMotion = useMemo(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const model = useMemo(
    () =>
      rollupToArchifyIR(rollup, {
        meta,
        neighbourhood,
        drillFocus,
        title: projectName ? `${projectName} map` : 'Codebase map',
        reducedMotion,
      }),
    [rollup, meta, neighbourhood, drillFocus, projectName, reducedMotion],
  );

  const html = useMemo(() => {
    if (!model) return null;
    const delivered = deliverArchitectureHtml(model.diagram);
    return injectViewerFlags(delivered.html, presentOnCreate.current);
  }, [model]);

  const syncPresent = useCallback(() => {
    const win = iframeRef.current?.contentWindow as ArchifyWindow | null;
    const stage = win?.Archify?.presentation;
    if (!stage) return;
    if (present && !stage.active()) stage.enter();
    if (!present && stage.active()) stage.exit();
  }, [present]);

  useEffect(() => {
    syncPresent();
  }, [syncPresent, html]);

  const handleIframeLoad = useCallback(() => {
    syncPresent();
    const doc = iframeRef.current?.contentDocument;
    if (!doc || !model) return;
    const onClick = (ev: MouseEvent) => {
      const node = (ev.target as Element | null)?.closest?.('[data-node-id]');
      if (!node) return;
      const irId = node.getAttribute('data-node-id');
      if (!irId || model.kindByIrId[irId] !== 'folder') return;
      const sourceId = model.sourceByIrId[irId];
      if (sourceId) onHubClick?.(sourceId);
    };
    doc.addEventListener('click', onClick);
  }, [model, onHubClick, syncPresent]);

  const exportShareCard = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    const btn = doc?.querySelector<HTMLButtonElement>('button[data-format="share-card"]');
    btn?.click();
  }, []);

  const hubCount = model?.diagram.components.filter((c) => model.kindByIrId[c.id] === 'folder').length ?? 0;
  const fileCount = model?.diagram.components.filter((c) => model.kindByIrId[c.id] === 'file').length ?? 0;
  const routeCount = model?.diagram.connections.length ?? 0;
  const isDrill = Boolean(drillFocus && neighbourhood && fileCount > 0);

  if (!model) {
    return (
      <div style={{ padding: 'var(--sp-5)', color: 'var(--ink-3)', fontSize: 'var(--text-sm)' }}>
        No folders to display.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        <span className="panel__hint">
          {isDrill ? (
            <>
              {fileCount} file{fileCount !== 1 ? 's' : ''} around {drillFocus} · {routeCount} route
              {routeCount !== 1 ? 's' : ''} · Archify
            </>
          ) : (
            <>
              {hubCount} folder{hubCount !== 1 ? 's' : ''} · {routeCount} route
              {routeCount !== 1 ? 's' : ''} · Signal Flow
            </>
          )}
        </span>
        <button
          type="button"
          className="btn"
          onClick={exportShareCard}
          style={{ fontSize: 'var(--text-sm)', padding: '2px 10px', marginLeft: 'auto' }}
          title="Export 1200×630 PNG share card"
        >
          Share
        </button>
      </div>

      <div
        className="archify-map-frame"
        role="img"
        aria-label="Codebase folder map"
        style={{
          overflow: 'hidden',
          maxHeight: present ? 'none' : '65vh',
          height: present ? 'calc(100vh - 48px)' : '65vh',
          background: 'var(--surface-panel)',
          borderRadius: present ? 0 : 'var(--radius-md)',
          border: present ? 'none' : '1px solid var(--line-1)',
          contain: 'content',
        }}
      >
        {html ? (
          <iframe
            ref={iframeRef}
            title="Codebase folder map"
            srcDoc={html}
            onLoad={handleIframeLoad}
            style={{
              display: 'block',
              width: '100%',
              height: '100%',
              border: 0,
              background: 'var(--surface-panel)',
            }}
          />
        ) : null}
      </div>

      <ul className="visually-hidden">
        {model.diagram.components.map((component) => {
          const sourceId = model.sourceByIrId[component.id];
          const kind = model.kindByIrId[component.id];
          if (kind === 'folder') {
            return (
              <li key={component.id}>
                <button
                  type="button"
                  onClick={() => onHubClick?.(sourceId)}
                  aria-label={`Folder: ${sourceId.replace(/^dir:/, '')}/`}
                >
                  {component.label}
                </button>
              </li>
            );
          }
          return (
            <li key={component.id}>
              <span aria-label={`File: ${sourceId}`}>{component.label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default memo(RollupMap);
