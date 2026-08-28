import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getApiToken, setApiToken, setActiveProjectId, getActiveProjectId, api, ApiError, pollJob, type AnalyserStatuses, type DiagnosticFinding, type ErrorChain, type GraphEdge, type GraphOverview, type GraphRollup, type HealthSnapshot, type Project, type TargetEnvironment, type TreeFile, type UsageReport } from '../api/client';
import type { LocalProjectManifest } from '../lib/localProjectStore';
import { deleteLocalProjectsForServerId, listLocalProjects } from '../lib/localProjectStore';
import { isRollupFolderNode } from '../lib/rollupMapModel';

type LoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export type RollupMeta = {
  total?: number;
  returned?: number;
  truncated?: boolean;
  cap?: number;
  reason?: string;
  focus?: string;
  radius?: number;
};

type ProjectContextValue = {
  token: string;
  setToken: (t: string) => void;
  projects: Project[];
  project: Project | null;
  selectProject: (id: string) => void;
  refreshProjects: () => Promise<void>;
  health: HealthSnapshot | null;
  healthHistory: HealthSnapshot[];
  graphEdges: GraphEdge[];
  graphRollup: GraphRollup | null;
  rollupStatus: LoadState;
  rollupError: string | null;
  rollupMeta: RollupMeta;
  graphNeighbourhood: GraphOverview | null;
  neighbourhoodStatus: LoadState;
  neighbourhoodError: string | null;
  neighbourhoodMeta: RollupMeta;
  neighbourhoodFocus: string | null;
  usage: UsageReport | null;
  errors: DiagnosticFinding[];
  analysers: AnalyserStatuses;
  chains: ErrorChain[];
  tree: TreeFile[];
  /** Cache key for Explore model jobs (`projectId:scannedAt`). */
  graphSnapshotId: string | null;
  targets: TargetEnvironment[];
  localManifest: LocalProjectManifest | null;
  setLocalManifest: (m: LocalProjectManifest | null) => void;
  status: LoadState;
  errorMessage: string | null;
  jobMessage: string | null;
  reloadAll: () => Promise<void>;
  /** Lazy-load GET /graph (+ /tree if needed) after the user opens Graph. */
  ensureExploreData: () => Promise<void>;
  /** Node tree: GET /tree without /graph. Safe beside Map first-paint. */
  ensureTree: () => Promise<void>;
  /** IG-32: folder-only rollup for Map first-paint. Does not call /graph or /graph/overview. */
  ensureMapRollup: () => Promise<void>;
  /** IG-33: hub drill — GET /graph/neighbourhood. Never part of Map first-paint. */
  ensureMapNeighbourhood: (focus: string) => Promise<void>;
  clearMapNeighbourhood: () => void;
  rescan: () => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
};

const ProjectContext = createContext<ProjectContextValue | null>(null);

{
  const injected = window.lssDesktop?.apiToken;
  if (injected) setApiToken(injected);
}

function asRollupMeta(meta: Record<string, unknown> | undefined): RollupMeta {
  if (!meta) return {};
  return {
    total: typeof meta.total === 'number' ? meta.total : undefined,
    returned: typeof meta.returned === 'number' ? meta.returned : undefined,
    truncated: typeof meta.truncated === 'boolean' ? meta.truncated : undefined,
    cap: typeof meta.cap === 'number' ? meta.cap : undefined,
    reason: typeof meta.reason === 'string' ? meta.reason : undefined,
    focus: typeof meta.focus === 'string' ? meta.focus : undefined,
    radius: typeof meta.radius === 'number' ? meta.radius : undefined,
  };
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState(getApiToken);
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [healthHistory, setHealthHistory] = useState<HealthSnapshot[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [graphRollup, setGraphRollup] = useState<GraphRollup | null>(null);
  const [rollupStatus, setRollupStatus] = useState<LoadState>('idle');
  const [rollupError, setRollupError] = useState<string | null>(null);
  const [rollupMeta, setRollupMeta] = useState<RollupMeta>({});
  const [graphNeighbourhood, setGraphNeighbourhood] = useState<GraphOverview | null>(null);
  const [neighbourhoodStatus, setNeighbourhoodStatus] = useState<LoadState>('idle');
  const [neighbourhoodError, setNeighbourhoodError] = useState<string | null>(null);
  const [neighbourhoodMeta, setNeighbourhoodMeta] = useState<RollupMeta>({});
  const [neighbourhoodFocus, setNeighbourhoodFocus] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [errors, setErrors] = useState<DiagnosticFinding[]>([]);
  const [analysers, setAnalysers] = useState<AnalyserStatuses>({});
  const [chains, setChains] = useState<ErrorChain[]>([]);
  const [tree, setTree] = useState<TreeFile[]>([]);
  const [graphSnapshotId, setGraphSnapshotId] = useState<string | null>(null);
  const [targets, setTargets] = useState<TargetEnvironment[]>([]);
  const [localManifest, setLocalManifest] = useState<LocalProjectManifest | null>(null);
  const [status, setStatus] = useState<LoadState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [jobMessage, setJobMessage] = useState<string | null>(null);
  const exploreLoadedFor = useRef<string | null>(null);
  const treeLoadedFor = useRef<string | null>(null);
  const rollupLoadedFor = useRef<string | null>(null);
  const neighbourhoodSeq = useRef(0);

  const setToken = (t: string) => {
    setApiToken(t);
    setTokenState(t);
  };

  const refreshProjects = useCallback(async () => {
    const { data } = await api.projects();
    setProjects(data);
    const activeId = getActiveProjectId();
    const chosen = data.find((p) => p.id === activeId) ?? data[0] ?? null;
    if (chosen) {
      setActiveProjectId(chosen.id);
      setProject(chosen);
    } else {
      setProject(null);
    }
  }, []);

  /** Phase 3: Health cold start via bootstrap; Explore graph/tree loaded lazily. */
  const reloadAll = useCallback(async () => {
    if (!getApiToken()) {
      setStatus('empty');
      setErrorMessage('Add an API bearer token in Settings (php artisan token:issue).');
      return;
    }
    setStatus('loading');
    setErrorMessage(null);
    exploreLoadedFor.current = null;
    treeLoadedFor.current = null;
    rollupLoadedFor.current = null;
    setGraphEdges([]);
    setTree([]);
    setGraphRollup(null);
    setRollupStatus('idle');
    setRollupError(null);
    setRollupMeta({});
    setGraphNeighbourhood(null);
    setNeighbourhoodStatus('idle');
    setNeighbourhoodError(null);
    setNeighbourhoodMeta({});
    setNeighbourhoodFocus(null);
    neighbourhoodSeq.current += 1;
    setGraphSnapshotId(null);
    try {
      await refreshProjects();
      const id = getActiveProjectId();
      if (!id) {
        setStatus('empty');
        setErrorMessage('No projects yet — drop a folder on Explore to import, or seed the demo.');
        return;
      }
      const [boot, hist, errEnv, tgtEnv] = await Promise.all([
        api.bootstrap(id),
        api.healthHistory(id),
        api.errors(id),
        api.targetEnvs(id),
      ]);
      setProject(boot.data.project);
      setHealth(boot.data.health);
      setUsage(boot.data.usage);
      setAnalysers(boot.data.analysers ?? {});
      setHealthHistory(Array.isArray(hist.data) ? hist.data : []);
      setErrors(Array.isArray(errEnv.data) ? errEnv.data : []);
      setChains(errEnv.chains ?? []);
      if (errEnv.analysers && Object.keys(errEnv.analysers).length > 0) {
        setAnalysers(errEnv.analysers);
      }
      setTargets(Array.isArray(tgtEnv.data) ? tgtEnv.data : []);
      const locals = await listLocalProjects();
      setLocalManifest(locals.find((m) => m.serverProjectId === id) ?? null);
      setStatus('ready');
    } catch (e) {
      setStatus('error');
      setErrorMessage(e instanceof ApiError ? e.message : 'Failed to load');
    }
  }, [refreshProjects]);

  const ensureTree = useCallback(async () => {
    const id = getActiveProjectId();
    if (!id || !getApiToken()) return;
    if (treeLoadedFor.current === id) return;
    try {
      const treeEnv = await api.tree(id);
      setTree(Array.isArray(treeEnv.data) ? treeEnv.data : []);
      treeLoadedFor.current = id;
    } catch (e) {
      setErrorMessage(e instanceof ApiError ? e.message : 'Failed to load tree');
    }
  }, []);

  /** Graph tab only — GET /graph. Never part of Map first-paint. */
  const ensureExploreData = useCallback(async () => {
    const id = getActiveProjectId();
    if (!id || !getApiToken()) return;
    if (exploreLoadedFor.current === id) return;
    try {
      const graphPromise = api.graph(id);
      const treePromise = treeLoadedFor.current === id ? Promise.resolve(null) : api.tree(id);
      const [graph, treeEnv] = await Promise.all([graphPromise, treePromise]);
      const edges = graph.data?.edges ?? [];
      const files = treeEnv
        ? (Array.isArray(treeEnv.data) ? treeEnv.data : [])
        : null;
      setGraphEdges(edges);
      if (files) {
        setTree(files);
        treeLoadedFor.current = id;
      }
      setGraphSnapshotId(
        graph.data?.scannedAt
          ? `${id}:${graph.data.scannedAt}`
          : `${id}:none:${edges.length}:${files?.length ?? 0}`,
      );
      exploreLoadedFor.current = id;
    } catch (e) {
      setErrorMessage(e instanceof ApiError ? e.message : 'Failed to load explore data');
    }
  }, []);

  const ensureMapRollup = useCallback(async () => {
    const id = getActiveProjectId();
    if (!id || !getApiToken()) return;
    if (rollupLoadedFor.current === id) return;
    setRollupStatus('loading');
    setRollupError(null);
    try {
      const env = await api.graphRollup(id, 1);
      rollupLoadedFor.current = id;
      setRollupMeta(asRollupMeta(env.meta));
      if (env.data == null) {
        setGraphRollup(null);
        setRollupStatus('empty');
        return;
      }
      setGraphRollup(env.data);
      const folderCount = env.data.nodes.filter(isRollupFolderNode).length;
      setRollupStatus(folderCount === 0 ? 'empty' : 'ready');
    } catch (e) {
      setRollupStatus('error');
      setRollupError(e instanceof ApiError ? e.message : 'Failed to load map rollup');
    }
  }, []);

  const clearMapNeighbourhood = useCallback(() => {
    neighbourhoodSeq.current += 1;
    setGraphNeighbourhood(null);
    setNeighbourhoodStatus('idle');
    setNeighbourhoodError(null);
    setNeighbourhoodMeta({});
    setNeighbourhoodFocus(null);
  }, []);

  const ensureMapNeighbourhood = useCallback(async (focus: string) => {
    const id = getActiveProjectId();
    if (!id || !getApiToken() || focus === '') return;
    const seq = ++neighbourhoodSeq.current;
    setNeighbourhoodFocus(focus);
    setNeighbourhoodStatus('loading');
    setNeighbourhoodError(null);
    try {
      const env = await api.graphNeighbourhood(id, focus, 1);
      if (seq !== neighbourhoodSeq.current) return;
      setNeighbourhoodMeta(asRollupMeta(env.meta));
      if (env.data == null) {
        setGraphNeighbourhood(null);
        setNeighbourhoodStatus('empty');
        return;
      }
      setGraphNeighbourhood(env.data);
      const fileCount = env.data.nodes.filter((node) => node.kind === 'file' && !node.external).length;
      setNeighbourhoodStatus(fileCount === 0 ? 'empty' : 'ready');
    } catch (e) {
      if (seq !== neighbourhoodSeq.current) return;
      setNeighbourhoodStatus('error');
      setNeighbourhoodError(e instanceof ApiError ? e.message : 'Failed to load neighbourhood');
    }
  }, []);

  const selectProject = useCallback(
    (id: string) => {
      setActiveProjectId(id);
      void reloadAll();
    },
    [reloadAll],
  );

  const rescan = useCallback(async () => {
    if (!project) return;
    setJobMessage('Queuing re-scan…');
    try {
      const { data } = await api.rescan(project.id);
      setJobMessage(`Analyze ${data.analyzeJobId} · snapshot ${data.snapshotJobId}`);
      await pollJob(data.analyzeJobId, (j) => setJobMessage(`Analyze: ${j.status} ${j.progress}% — ${j.message ?? ''}`));
      await pollJob(data.snapshotJobId, (j) => setJobMessage(`Snapshot: ${j.status} ${j.progress}%`));
      await reloadAll();
      setJobMessage('Re-scan complete');
    } catch (e) {
      setJobMessage(e instanceof ApiError ? e.message : 'Re-scan failed');
    }
  }, [project, reloadAll]);

  const deleteProject = useCallback(async (id: string) => {
    setJobMessage('Deleting project…');
    try {
      await api.deleteProject(id);
      await deleteLocalProjectsForServerId(id);
      if (getActiveProjectId() === id) {
        setLocalManifest(null);
        setActiveProjectId(null);
      }
      await refreshProjects();
      await reloadAll();
      setJobMessage('Project deleted');
    } catch (e) {
      setJobMessage(e instanceof ApiError ? e.message : 'Delete failed');
      throw e;
    }
  }, [refreshProjects, reloadAll]);

  useEffect(() => {
    void reloadAll();
  }, [token, reloadAll]);

  const value = useMemo(
    () => ({
      token,
      setToken,
      projects,
      project,
      selectProject,
      refreshProjects,
      health,
      healthHistory,
      graphEdges,
      graphRollup,
      rollupStatus,
      rollupError,
      rollupMeta,
      graphNeighbourhood,
      neighbourhoodStatus,
      neighbourhoodError,
      neighbourhoodMeta,
      neighbourhoodFocus,
      usage,
      errors,
      analysers,
      chains,
      tree,
      graphSnapshotId,
      targets,
      localManifest,
      setLocalManifest,
      status,
      errorMessage,
      jobMessage,
      reloadAll,
      ensureExploreData,
      ensureTree,
      ensureMapRollup,
      ensureMapNeighbourhood,
      clearMapNeighbourhood,
      rescan,
      deleteProject,
    }),
    [
      token,
      projects,
      project,
      selectProject,
      refreshProjects,
      health,
      healthHistory,
      graphEdges,
      graphRollup,
      rollupStatus,
      rollupError,
      rollupMeta,
      graphNeighbourhood,
      neighbourhoodStatus,
      neighbourhoodError,
      neighbourhoodMeta,
      neighbourhoodFocus,
      usage,
      errors,
      analysers,
      chains,
      tree,
      graphSnapshotId,
      targets,
      localManifest,
      status,
      errorMessage,
      jobMessage,
      reloadAll,
      ensureExploreData,
      ensureTree,
      ensureMapRollup,
      ensureMapNeighbourhood,
      clearMapNeighbourhood,
      rescan,
      deleteProject,
    ],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject requires ProjectProvider');
  return ctx;
}
