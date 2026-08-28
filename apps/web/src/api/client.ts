export type ApiProblem = {
  status?: number;
  title?: string;
  detail?: string;
  /** DSK-7 machine-readable code for stable client-side branching. */
  code?: string;
  /** DSK-7: for `code === 'path_not_allowed'` — the path the server refused. */
  rejectedPath?: string;
  violations?: Array<{ field: string; message: string }>;
};

export type ApiEnvelope<T> = {
  data: T;
  meta: Record<string, unknown>;
  errors: ApiProblem[];
};

function formatApiError(body: ApiEnvelope<unknown> | null, fallback: string): string {
  const dataMsg =
    body?.data && typeof body.data === 'object' && body.data !== null && 'message' in body.data
      ? String((body.data as { message?: string }).message ?? '').trim()
      : '';
  if (dataMsg) return dataMsg;

  const err = body?.errors?.[0];
  if (!err) return fallback;
  const violations = err.violations?.filter((v) => v.message.trim()).map((v) => v.message) ?? [];
  if (violations.length > 0) return violations.join(' · ');
  return err.detail ?? err.title ?? fallback;
}

export type Project = {
  id: string;
  name: string;
  sourceType?: 'import' | 'local';
  localSourcePath?: string | null;
  sandboxPath: string | null;
  sandboxSizeBytes?: number | null;
  lastImportedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  fileCount?: number;
};

export type HealthSnapshot = {
  projectId: string;
  takenAt: string;
  scores: {
    overall: number;
    errors: number;
    dependencies: number;
    tests: number;
    structure: number;
  };
  metrics: {
    errorCounts: { error: number; warning: number; info: number };
    errorChains: number;
    missingDeps: number;
    outdatedDeps: number;
    undeclaredEnvVars: number;
    testPassRate: number;
    testsTotal: number;
    filesAnalysed: number;
    hotspots: Array<{ file: string; centrality: number; errorDensity: number }>;
  };
  topIssues: Array<{
    dimension: string;
    refType: string;
    refId: string;
    summary: string;
  }>;
};

export type AnalyserStatus = 'missing_binary' | 'clean' | 'ok' | string;

export type AnalyserStatuses = Record<string, AnalyserStatus>;

export type DiagnosticFinding = {
  id: string;
  source: string;
  ruleId: string;
  kind: string;
  severity: 'error' | 'warning' | 'info';
  file: string;
  range: { startLine: number; startCol: number; endLine: number; endCol: number };
  message: string;
  explanation: string | null;
  upstream: string[];
  downstream: string[];
};

/**
 * DX-8/11: chain grouping from the errors endpoint's meta. Error rows stay
 * exactly C5-shaped; chain membership arrives separately.
 */
export type ErrorChain = {
  chainId: string;
  rootErrorIds: string[];
  errorIds: string[];
};

export type GraphEdge = { from: string; to: string; kind?: string; line?: number | null };

export type GraphOverviewNode = {
  id: string;
  name: string;
  kind: 'file' | 'folder' | 'external';
  folder: string;
  folderPath?: string;
  fileCount: number;
  errors: number;
  degree: number;
  inDegree: number;
  external: boolean;
};

export type GraphOverviewLink = {
  source: string;
  target: string;
  weight: number;
  externalTarget: boolean;
};

export type GraphOverview = {
  projectId: string;
  scannedAt: string | null;
  nodes: GraphOverviewNode[];
  links: GraphOverviewLink[];
};

export type UsageReport = {
  uses: { languages: string[]; frameworks: string[]; deps: Array<{ name: string; version: string; source: string }> };
  needs: { missingDeps: string[]; envVars: string[]; services: string[] };
};

export type JobStatus = {
  id: string;
  type: string;
  projectId: string | null;
  status: 'queued' | 'running' | 'done' | 'failed';
  progress: number;
  message: string | null;
  result?: { analyzeJobId?: string; snapshotJobId?: string } | null;
};

/** Default poll window covers long PHPStan runs (worker timeout ~660s). */
export const JOB_POLL_TIMEOUT_MS = 600_000;

export const QUEUE_HINT =
  'Job stuck — run `php artisan queue:listen` (or queue:work) in apps/api, or set QUEUE_CONNECTION=sync for local single-process.';

export type TargetEnvironment = {
  id: string;
  projectId: string;
  name: string;
  baseUrl: string;
  notes: string | null;
};

export type TreeFile = { path: string; size: number; lang: string | null };

export type LocalRoot = {
  id: string;
  path: string;
  createdAt: string | null;
  updatedAt: string | null;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: ApiEnvelope<unknown>,
  ) {
    super(message);
  }
}

const TOKEN_KEY = 'lss.apiToken';
const PROJECT_KEY = 'lss.projectId';

export function getApiToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function setApiToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getActiveProjectId(): string | null {
  return localStorage.getItem(PROJECT_KEY);
}

export function setActiveProjectId(id: string | null): void {
  if (id) localStorage.setItem(PROJECT_KEY, id);
  else localStorage.removeItem(PROJECT_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<ApiEnvelope<T>> {
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  const token = getApiToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { ...init, headers });
  } catch {
    throw new ApiError('API unreachable — is php artisan serve running?', 0);
  }

  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok) {
    if (!body) {
      const hint =
        res.status >= 500
          ? ' — the server may have timed out while scanning a large folder; check apps/api/storage/logs/laravel.log'
          : '';
      throw new ApiError(`${res.statusText || `HTTP ${res.status}`}${hint}`, res.status);
    }
    const dataMsg =
      body?.data && typeof body.data === 'object' && body.data !== null && 'message' in body.data
        ? String((body.data as { message?: string }).message ?? '')
        : '';
    const detail = formatApiError(body, dataMsg || res.statusText || `HTTP ${res.status}`);
    throw new ApiError(detail || `HTTP ${res.status}`, res.status, body ?? undefined);
  }
  if (!body) throw new ApiError('Empty response', res.status);
  return body;
}

export const api = {
  health: () => request<{ status: string; time: string }>('/health'),
  projects: () => request<Project[]>('/projects').then(async (env) => {
    // paginated list returns data as array inside paginator shape — handle both
    const data = env.data as unknown;
    if (Array.isArray(data)) return { ...env, data };
    if (data && typeof data === 'object' && Array.isArray((data as { data?: unknown }).data)) {
      return { ...env, data: (data as { data: Project[] }).data };
    }
    return env as ApiEnvelope<Project[]>;
  }),
  project: (id: string) => request<Project>(`/projects/${id}`),
  createProject: (name: string) =>
    request<Project>('/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  deleteProject: (id: string) =>
    request<{ deleted: boolean }>(`/projects/${id}`, { method: 'DELETE' }),
  linkLocal: (projectId: string, path: string, name?: string) =>
    request<{ jobId: string; status: string; projectId: string; message?: string }>(
      `/projects/${projectId}/link-local`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, ...(name ? { name } : {}) }),
      },
    ),
  importZip: async (projectId: string, blob: Blob, name: string, resumeToken?: string) => {
    const form = new FormData();
    const archive =
      blob instanceof File ? blob : new File([blob], `${name}.zip`, { type: 'application/zip' });
    form.append('archive', archive);
    form.append('name', name);
    if (resumeToken) form.append('resumeToken', resumeToken);
    return request<{ jobId: string; status: string; projectId: string; message?: string }>(`/projects/${projectId}/import`, {
      method: 'POST',
      body: form,
    });
  },
  job: (id: string) => request<JobStatus>(`/jobs/${id}`),
  healthReport: (id: string) => request<HealthSnapshot | null>(`/projects/${id}/health-report`),
  healthHistory: (id: string) => request<HealthSnapshot[]>(`/projects/${id}/health-report/history`),
  bootstrap: (id: string) =>
    request<{
      project: Project;
      health: HealthSnapshot | null;
      usage: UsageReport | null;
      analysers: AnalyserStatuses;
    }>(`/projects/${id}/bootstrap`),
  graph: (id: string) =>
    request<{ projectId: string; scannedAt: string; edges: GraphEdge[] } | null>(`/projects/${id}/graph`),
  /** IG-29: ranked overview slice — does not replace `graph()`. */
  graphOverview: (id: string, limit?: number) =>
    request<GraphOverview | null>(
      `/projects/${id}/graph/overview${limit != null ? `?limit=${limit}` : ''}`,
    ),
  usageReport: (id: string) =>
    request<{ projectId: string; report: UsageReport; createdAt: string | null } | null>(
      `/projects/${id}/usage-report`,
    ),
  // DX-9: depth 1–3 controls the downstream view (default 1 = direct dependents).
  errors: (id: string, depth?: number) =>
    request<DiagnosticFinding[]>(
      `/projects/${id}/errors${depth ? `?depth=${depth}` : ''}`,
    ).then((env) => ({
      ...env,
      analysers: (env.meta?.analysers as AnalyserStatuses | undefined) ?? {},
      chains: (env.meta?.chains as ErrorChain[] | undefined) ?? [],
    })),
  tree: (id: string) => request<TreeFile[]>(`/projects/${id}/tree`),
  file: (id: string, path: string) =>
    request<{
      path: string;
      binary: boolean;
      content: string | null;
      size: number;
      lang: string | null;
      missingOnDisk?: boolean;
    }>(`/projects/${id}/file?path=${encodeURIComponent(path)}`),
  rescan: (id: string) =>
    request<{ analyzeJobId: string; snapshotJobId: string }>(`/projects/${id}/rescan`, { method: 'POST' }),
  analyze: (id: string) => request<{ jobId: string }>(`/projects/${id}/analyze`, { method: 'POST' }),
  snapshot: (id: string) => request<{ jobId: string }>(`/projects/${id}/snapshot`, { method: 'POST' }),
  targetEnvs: (id: string) => request<TargetEnvironment[]>(`/projects/${id}/target-environments`),
  saveTargetEnv: (id: string, body: { name: string; baseUrl: string; notes?: string }) =>
    request<TargetEnvironment>(`/projects/${id}/target-environments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  probeTarget: (projectId: string, envId: string) =>
    request<{ reachable: boolean; status: number | null; error: string | null }>(
      `/projects/${projectId}/target-environments/${envId}/probe`,
      { method: 'POST' },
    ),
  localRoots: () => request<LocalRoot[]>('/local-roots'),
  addLocalRoot: (path: string) =>
    request<LocalRoot>('/local-roots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }),
  removeLocalRoot: (id: string) =>
    request<null>(`/local-roots/${id}`, { method: 'DELETE' }),
};

export async function pollJob(
  jobId: string,
  onUpdate?: (job: JobStatus) => void,
  timeoutMs = JOB_POLL_TIMEOUT_MS,
): Promise<JobStatus> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await api.job(jobId);
    onUpdate?.(data);
    if (data.status === 'done' || data.status === 'failed') return data;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new ApiError(`Job timed out after ${Math.round(timeoutMs / 1000)}s. ${QUEUE_HINT}`, 408);
}

/** After link/import finishes, poll queued analyze → snapshot if present in job.result. */
export async function pollAnalyzeFollowOn(
  job: JobStatus,
  onUpdate?: (stage: 'analyze' | 'snapshot', j: JobStatus) => void,
  timeoutMs = JOB_POLL_TIMEOUT_MS,
): Promise<void> {
  const analyzeId = job.result?.analyzeJobId;
  const snapshotId = job.result?.snapshotJobId;
  if (analyzeId) {
    const analyze = await pollJob(analyzeId, (j) => onUpdate?.('analyze', j), timeoutMs);
    if (analyze.status === 'failed') {
      throw new Error(analyze.message ?? 'Analyze failed');
    }
  }
  if (snapshotId) {
    const snapshot = await pollJob(snapshotId, (j) => onUpdate?.('snapshot', j), timeoutMs);
    if (snapshot.status === 'failed') {
      throw new Error(snapshot.message ?? 'Health snapshot failed');
    }
  }
}
