import { handleModelJob, type ModelJob, type ModelResult } from '../lib/modelJobs';

type WorkerScope = {
  onmessage: ((ev: MessageEvent<ModelJob>) => void) | null;
  postMessage: (msg: ModelResult) => void;
};

const worker = self as unknown as WorkerScope;

worker.onmessage = (event: MessageEvent<ModelJob>) => {
  const job = event.data;
  try {
    worker.postMessage(handleModelJob(job));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Model worker failed';
    worker.postMessage({ kind: 'error', requestId: job.requestId, message });
  }
};
