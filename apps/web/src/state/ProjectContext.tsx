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
import { getApiToken, setApiToken, setActiveProjectId, getActiveProjectId, api, ApiError, pollJob, type AnalyserStatuses, type DiagnosticFinding, type ErrorChain, type GraphEdge, type HealthSnapshot, type Project, type TargetEnvironment, type TreeFile, type UsageReport } from '../api/client';
import type { LocalProjectManifest } from '../lib/localProjectStore';
import { deleteLocalProjectsForServerId, listLocalProjects } from '../lib/localProjectStore';

type LoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

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
  usage: UsageReport | null;
  errors: DiagnosticFinding[];
  analysers: AnalyserStatuses;
  chains: ErrorChain[];
  tree: TreeFile[];
  targets: TargetEnvironment[];
  localManifest: LocalProjectManifest | null;
  setLocalManifest: (m: LocalProjectManifest | null) => void;
  status: LoadState;
  errorMessage: string | null;
  jobMessage: string | null;
  reloadAll: () => Promise<void>;
  /** Lazy-load graph + tree for Explore (cache hit = ms). */
  ensureExploreData: () => Promise<void>;
  rescan: () => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
};

const ProjectContext = createContext<ProjectContextValue | null>(null);

{
  const injected = window.lssDesktop?.apiToken;
  if (injected) setApiToken(injected);
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState(getApiToken);
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [healthHistory, setHealthHistory] = useState<HealthSnapshot[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [errors, setErrors] = useState<DiagnosticFinding[]>([]);
  const [analysers, setAnalysers] = useState<AnalyserStatuses>({});
  const [chains, setChains] = useState<ErrorChain[]>([]);
  const [tree, setTree] = useState<TreeFile[]>([]);
  const [targets, setTargets] = useState<TargetEnvironment[]>([]);
  const [localManifest, setLocalManifest] = useState<LocalProjectManifest | null>(null);
  const [status, setStatus] = useState<LoadState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [jobMessage, setJobMessage] = useState<string | null>(null);
  const exploreLoadedFor = useRef<string | null>(null);

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
    setGraphEdges([]);
    setTree([]);
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

  const ensureExploreData = useCallback(async () => {
    const id = getActiveProjectId();
    if (!id || !getApiToken()) return;
    if (exploreLoadedFor.current === id) return;
    try {
      const [graph, treeEnv] = await Promise.all([api.graph(id), api.tree(id)]);
      setGraphEdges(graph.data?.edges ?? []);
      setTree(Array.isArray(treeEnv.data) ? treeEnv.data : []);
      exploreLoadedFor.current = id;
    } catch (e) {
      setErrorMessage(e instanceof ApiError ? e.message : 'Failed to load explore data');
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
      usage,
      errors,
      analysers,
      chains,
      tree,
      targets,
      localManifest,
      setLocalManifest,
      status,
      errorMessage,
      jobMessage,
      reloadAll,
      ensureExploreData,
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
      usage,
      errors,
      analysers,
      chains,
      tree,
      targets,
      localManifest,
      status,
      errorMessage,
      jobMessage,
      reloadAll,
      ensureExploreData,
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
