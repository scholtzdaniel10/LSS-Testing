import { useEffect, useRef, useState } from 'react';
import { animate, stagger } from 'animejs';
import { useEntrance } from '../lib/anim';
import { folders, graphEdges, graphNodes, tree, type GraphNode } from '../mock/data';

const seriesVar = (slot: number) => (slot === 0 ? 'var(--series-other)' : `var(--series-${slot})`);
const folderColor = (name: string) => seriesVar(folders.find((f) => f.name === name)?.series ?? 0);

const GRAPH_W = 960;
const GRAPH_H = 460;

const ExplorePage: React.FC = () => {
  const ref = useEntrance();
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const graphRef = useRef<SVGSVGElement>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !graphRef.current) return;
    ran.current = true;
    animate(graphRef.current.querySelectorAll('.graph-node'), {
      opacity: [0, 1],
      scale: [0.4, 1],
      duration: 600,
      delay: stagger(35, { start: 200 }),
      ease: 'outBack',
    });
    animate(graphRef.current.querySelectorAll('line[data-edge]'), {
      opacity: [0, 1],
      duration: 500,
      delay: stagger(20, { start: 500 }),
      ease: 'linear',
    });
  }, []);

  const nodeById = (id: string) => graphNodes.find((n) => n.id === id)!;

  return (
    <div className="page">
      <div className="page__inner" ref={ref} style={{ maxWidth: 1320 }}>
        <div data-animate>
          <h1 className="page__title">Explore</h1>
          <p className="page__subtitle">
            The program as a node tree and dependency graph — every file opens in your own IDE.
          </p>
        </div>

        <div className="split" data-animate>
          <div className="panel">
            <div className="panel__head">
              <h2 className="panel__title">Node tree</h2>
              <span className="panel__hint">links in/out · error badge</span>
            </div>
            <div className="tree">
              {tree.map((item) => (
                <div
                  key={item.path + item.depth}
                  className="tree__row"
                  style={{ paddingLeft: 6 + item.depth * 18 }}
                  role="button"
                  tabIndex={0}
                >
                  <span className="tree__dot" style={{ background: folderColor(item.folder) }} aria-hidden="true" />
                  <span>
                    {item.path}
                    {item.isDir ? '' : ''}
                  </span>
                  <span className={`tree__badge ${item.errors > 0 ? 'tree__badge--err' : ''}`}>
                    {item.links} links{item.errors > 0 ? ` · ${item.errors} err` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel__head">
              <h2 className="panel__title">Dependency graph</h2>
              <span className="panel__hint">node size = incoming links · click a node for details</span>
            </div>
            <div className="chart">
              <svg ref={graphRef} viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}>
                {graphEdges.map((e) => {
                  const a = nodeById(e.from);
                  const b = nodeById(e.to);
                  return (
                    <line
                      key={`${e.from}-${e.to}`}
                      data-edge
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="var(--line-2)"
                      strokeWidth={1}
                    />
                  );
                })}
                {graphNodes.map((n) => (
                  <g
                    key={n.id}
                    className="graph-node"
                    transform={`translate(${n.x}, ${n.y})`}
                    onClick={() => setSelected(n)}
                    role="button"
                    tabIndex={0}
                    aria-label={`${n.label}, ${n.inDegree} incoming links, ${n.errors} errors`}
                  >
                    <circle
                      r={5 + n.inDegree * 1.2}
                      fill={folderColor(n.folder)}
                      stroke="var(--surface-panel)"
                      strokeWidth={2}
                    />
                    {n.errors > 0 && (
                      <circle r={3.5} cx={6 + n.inDegree * 1.2} cy={-(6 + n.inDegree * 1.2)} fill="var(--status-serious)" stroke="var(--surface-panel)" strokeWidth={1.5} />
                    )}
                    <text y={22 + n.inDegree} textAnchor="middle">
                      {n.label}
                    </text>
                  </g>
                ))}
              </svg>
              <div className="legend" aria-hidden="true">
                {folders.map((f) => (
                  <span key={f.name} className="legend__item" style={{ cursor: 'default' }}>
                    <span className="legend__swatch" style={{ background: seriesVar(f.series) }} />
                    {f.name}
                  </span>
                ))}
                <span className="legend__item" style={{ cursor: 'default' }}>
                  <span className="legend__swatch" style={{ background: 'var(--status-serious)', borderRadius: '50%' }} />
                  has errors
                </span>
              </div>
            </div>

            {selected && (
              <div className="row-list" style={{ marginTop: 'var(--sp-3)', borderTop: '1px solid var(--line-1)' }}>
                <div className="row-list__row" style={{ cursor: 'default' }}>
                  <span className="row-list__grow mono">{selected.label}</span>
                  <span className="row-list__meta">
                    {selected.inDegree} in · {selected.errors} errors · folder {selected.folder}
                  </span>
                  <button type="button" className="btn" onClick={() => setSelected(null)}>
                    Open in IDE
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <p className="v0-banner" data-animate>
          v0 preview — static layout of 16 mock files; the real force-directed graph over contract C3 edges is IG-12.
        </p>
      </div>
    </div>
  );
};

export default ExplorePage;
