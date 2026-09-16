import {
  ApiError,
  api,
  getApiToken,
  pollAnalyzeFollowOn,
  pollJob,
  QUEUE_HINT,
  setActiveProjectId,
} from '../api/client';

const stageLabel = (stage: string): string => {
  if (stage === 'map') return 'Map';
  if (stage === 'diagnose') return 'Diagnose';
  if (stage === 'snapshot') return 'Snapshot';
  return stage;
};

/** Link a folder on disk to the API; returns when Map is ready (Diagnose may still run). */
export async function linkLocalFolder(
  localPath: string,
  options: {
    projectId?: string;
    projectName?: string;
    token?: string;
    onStatus?: (message: string) => void;
    /** Called with diagnose job id so the UI can keep polling without blocking Map. */
    onDiagnoseQueued?: (diagnoseJobId: string) => void;
  } = {},
): Promise<{ projectId: string; name: string; diagnoseJobId?: string }> {
  const bearer = getApiToken() || options.token;
  if (!bearer) {
    throw new Error('Sign in before linking a local folder.');
  }

  const trimmed = localPath.trim();
  if (!trimmed) {
    throw new Error('Enter the full path to your project folder (e.g. C:\\Projects\\my-app).');
  }

  let projectId = options.projectId;
  let name = options.projectName ?? trimmed.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? 'local-program';

  if (!projectId) {
    options.onStatus?.('Creating project…');
    const created = await api.createProject(name);
    projectId = created.data.id;
    name = created.data.name;
  }

  setActiveProjectId(projectId);
  options.onStatus?.('Queuing local folder link…');

  const linked = await api.linkLocal(projectId, trimmed, name);
  if (linked.data.status === 'failed') {
    throw new Error(linked.data.message ?? 'Local link failed on the server');
  }

  options.onStatus?.(`Link job ${linked.data.status}…`);
  const job = await pollJob(
    linked.data.jobId,
    (j) => options.onStatus?.(`Link: ${j.status} ${j.progress}% — ${j.message ?? ''}`),
  );

  if (job.status === 'failed') {
    throw new Error(job.message ?? 'Local link failed');
  }
  if (job.status !== 'done') {
    throw new Error(`Link stuck in "${job.status}". ${QUEUE_HINT}`);
  }

  const follow = await pollAnalyzeFollowOn(job, (stage, j) => {
    options.onStatus?.(
      `${stageLabel(stage)}: ${j.status} ${j.progress}% — ${j.message ?? ''}`,
    );
  });

  if (follow.diagnoseJobId) {
    options.onDiagnoseQueued?.(follow.diagnoseJobId);
    options.onStatus?.('Map ready · Diagnose running in background');
  }

  return { projectId, name, diagnoseJobId: follow.diagnoseJobId };
}

export { ApiError };
