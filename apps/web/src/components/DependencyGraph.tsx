/**
 * DependencyGraph — routes to lightweight DOM module list (no canvas).
 * Force-graph removed to avoid Chromium tile memory exhaustion in Electron.
 */

import ModuleGraphView, { FORCE_GRAPH_NODE_CAP } from './ModuleGraphView';
import type { GraphEdge } from '../api/client';

type Props = {
  edges: GraphEdge[];
  errorFiles: Map<string, number>;
  files?: string[];
  frameworks?: string[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onOpenFile: (path: string) => void;
  focusPath?: string | null;
};

/** @deprecated Kept for graphModel tests; canvas graph no longer mounted in UI. */
export { FORCE_GRAPH_NODE_CAP };

const DependencyGraph: React.FC<Props> = (props) => <ModuleGraphView {...props} />;

export default DependencyGraph;
