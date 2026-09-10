/**
 * IG-32: Explore Map host for Archify architecture HTML.
 * Live rollup → architecture IR → vendored Archify renderer → iframe.
 * First paint never paints hub-dot circles.
 * The viewer is sandboxed: imported names never execute same-origin with LSS.
 */

import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import type { GraphOverview, GraphRollup } from '../api/client';
import type { RollupPaintMeta } from '../lib/rollupMapModel';
import { rollupToArchifyIR, type ArchifyMapModel } from '../lib/rollupToArchify';
import { deliverArchitectureHtml } from '../lib/archifyDeliver';
import {
  ARCHIFY_HOST_SOURCE,
  ARCHIFY_IFRAME_SANDBOX,
  injectArchifyHost,
  isArchifyFrameMessage,
  postToArchifyFrame,
} from '../lib/archifyHost';

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
  const modelRef = useRef<ArchifyMapModel | null>(null);
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
  modelRef.current = model;

  const html = useMemo(() => {
    if (!model) return null;
    const delivered = deliverArchitectureHtml(model.diagram);
    return injectArchifyHost(delivered.html, present);
  }, [model, present]);

  const syncPresent = useCallback(() => {
    postToArchifyFrame(iframeRef.current?.contentWindow, {
      source: ARCHIFY_HOST_SOURCE,
      type: 'present',
      on: present,
    });
  }, [present]);

  useEffect(() => {
    syncPresent();
  }, [syncPresent, html]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isArchifyFrameMessage(event, iframeRef.current?.contentWindow)) return;
      if (event.data.type === 'ready') {
        syncPresent();
        return;
      }
      if (event.data.type !== 'node-click') return;
      const current = modelRef.current;
      const irId = event.data.id;
      if (!current || current.kindByIrId[irId] !== 'folder') return;
      const sourceId = current.sourceByIrId[irId];
      if (sourceId) onHubClick?.(sourceId);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onHubClick, syncPresent]);

  const handleIframeLoad = useCallback(() => {
    syncPresent();
  }, [syncPresent]);

  const exportShareCard = useCallback(() => {
    postToArchifyFrame(iframeRef.current?.contentWindow, {
      source: ARCHIFY_HOST_SOURCE,
      type: 'export-share-card',
    });
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
        }}
      >
        {html ? (
          <iframe
            ref={iframeRef}
            title="Codebase folder map"
            srcDoc={html}
            sandbox={ARCHIFY_IFRAME_SANDBOX}
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
