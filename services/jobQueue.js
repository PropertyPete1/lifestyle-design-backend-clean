/**
 * Simple in-memory job queue for non-blocking Post Now execution
 * Sequential processing, single worker
 */

let nextJobId = 1;
const jobQueue = [];
const jobStatusById = new Map();
let isProcessing = false;

async function processNext() {
  if (isProcessing) return;
  const job = jobQueue.shift();
  if (!job) return;
  isProcessing = true;

  const { id, handler } = job;
  const status = jobStatusById.get(id);
  if (status) {
    status.status = 'running';
    status.startedAt = new Date().toISOString();
  }

  try {
    const result = await handler();
    if (status) {
      status.status = 'success';
      status.finishedAt = new Date().toISOString();
      status.result = result;
    }
  } catch (error) {
    if (status) {
      status.status = 'error';
      status.finishedAt = new Date().toISOString();
      status.error = error?.message || String(error);
    }
  } finally {
    isProcessing = false;
    // Kick off next
    setImmediate(processNext);
  }
}

function enqueue(handler) {
  const id = String(nextJobId++);
  jobQueue.push({ id, handler });
  jobStatusById.set(id, {
    id,
    status: 'queued',
    enqueuedAt: new Date().toISOString(),
  });
  // Start processing if idle
  setImmediate(processNext);
  return id;
}

function getJobStatus(jobId) {
  return jobStatusById.get(jobId) || null;
}

function getQueueSnapshot() {
  return {
    queued: jobQueue.length,
    processing: isProcessing,
  };
}

module.exports = {
  enqueue,
  getJobStatus,
  getQueueSnapshot,
};

