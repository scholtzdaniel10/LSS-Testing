import { ApiError, api, getApiToken, pollJob, setActiveProjectId } from '../api/client';

/** Link a folder on disk to the API and wait for scan + health (no zip upload). */
export async function linkLocalFolder(
  localPath: string,
  options: {
    projectId?: string;
    projectName?: string;
    token?: string;
    onStatus?: (message: string) => void;
  } = {},
): Promise<{ projectId: string; name: string }> {
  const bearer = getApiToken() || options.token;
  if (!bearer) {
    throw new Error('Set an API token in Settings before linking a local folder.');
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
  options.onStatus?.('Linking local folder on API (scan + analysis)…');

  const linked = await api.linkLocal(projectId, trimmed, name);
  if (linked.data.status === 'failed') {
    throw new Error(linked.data.message ?? 'Local link failed on the server');
  }

  options.onStatus?.(`Link job ${linked.data.status}…`);
  const job = await pollJob(
    linked.data.jobId,
    (j) => options.onStatus?.(`Link: ${j.status} ${j.progress}% — ${j.message ?? ''}`),
    300_000,
  );

  if (job.status === 'failed') {
    throw new Error(job.message ?? 'Local link failed');
  }
  if (job.status !== 'done') {
    throw new Error(`Link stuck in "${job.status}". Set QUEUE_CONNECTION=sync in apps/api/.env.`);
  }

  return { projectId, name };
}

export { ApiError };
