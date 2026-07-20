import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getApiToken, setApiToken, setActiveProjectId, getActiveProjectId, api, ApiError, pollJob, type DiagnosticFinding, type GraphEdge, type HealthSnapshot, type Project, type TargetEnvironment, type TreeFile, type UsageReport } from '../api/client';
import type { LocalProjectManifest } from '../lib/localProjectStore';

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
  tree: TreeFile[];
  targets: TargetEnvironment[];
  localManifest: LocalProjectManifest | null;
  setLocalManifest: (m: LocalProjectManifest | null) => void;
  status: LoadState;
  errorMessage: string | null;
  jobMessage: string | null;
  reloadAll: () => Promise<void>;
  rescan: () => Promise<void>;
};

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState(getApiToken);
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [healthHistory, setHealthHistory] = useState<HealthSnapshot[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [errors, setErrors] = useState<DiagnosticFinding[]>([]);
  const [tree, setTree] = useState<TreeFile[]>([]);
  const [targets, setTargets] = useState<TargetEnvironment[]>([]);
  const [localManifest, setLocalManifest] = useState<LocalProjectManifest | null>(null);
  const [status, setStatus] = useState<LoadState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [jobMessage, setJobMessage] = useState<string | null>(null);

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

  const reloadAll = useCallback(async () => {
    if (!getApiToken()) {
      setStatus('empty');
      setErrorMessage('Add an API bearer token in Settings (php artisan token:issue).');
      return;
    }
    setStatus('loading');
    setErrorMessage(null);
    try {
      await refreshProjects();
      const id = getActiveProjectId();
      if (!id) {
        setStatus('empty');
        setErrorMessage('No projects yet — drop a folder on Explore to import, or seed the demo.');
        return;
      }
      const [proj, hr, hist, graph, usageEnv, errEnv, treeEnv, tgtEnv] = await Promise.all([
        api.project(id),
        api.healthReport(id),
        api.healthHistory(id),
        api.graph(id),
        api.usageReport(id),
        api.errors(id),
        api.tree(id),
        api.targetEnvs(id),
      ]);
      setProject(proj.data);
      setHealth(hr.data);
      setHealthHistory(Array.isArray(hist.data) ? hist.data : []);
      setGraphEdges(graph.data?.edges ?? []);
      const usagePayload = usageEnv.data;
      setUsage(usagePayload?.report ?? null);
      setErrors(Array.isArray(errEnv.data) ? errEnv.data : []);
      setTree(Array.isArray(treeEnv.data) ? treeEnv.data : []);
      setTargets(Array.isArray(tgtEnv.data) ? tgtEnv.data : []);
      setStatus('ready');
    } catch (e) {
      setStatus('error');
      setErrorMessage(e instanceof ApiError ? e.message : 'Failed to load');
    }
  }, [refreshProjects]);

  const selectProject = (id: string) => {
    setActiveProjectId(id);
    void reloadAll();
  };

  const rescan = async () => {
    if (!project) return;
    setJobMessage('Queuing re-scan…');
    try {
      const { data } = await api.rescan(project.id);
      setJobMessage(`Analyze ${data.analyzeJobId} · snapshot ${data.snapshotJobId}`);
      await pollJob(data.analyzeJobId, (j) => setJobMessage(`Analyze: ${j.status} ${j.progress}%`));
      await pollJob(data.snapshotJobId, (j) => setJobMessage(`Snapshot: ${j.status} ${j.progress}%`));
      await reloadAll();
      setJobMessage('Re-scan complete');
    } catch (e) {
      setJobMessage(e instanceof ApiError ? e.message : 'Re-scan failed');
    }
  };

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
      tree,
      targets,
      localManifest,
      setLocalManifest,
      status,
      errorMessage,
      jobMessage,
      reloadAll,
      rescan,
    }),
    [
      token,
      projects,
      project,
      refreshProjects,
      health,
      healthHistory,
      graphEdges,
      usage,
      errors,
      tree,
      targets,
      localManifest,
      status,
      errorMessage,
      jobMessage,
      reloadAll,
    ],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject requires ProjectProvider');
  return ctx;
}
