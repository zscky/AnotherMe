/**
 * Shared async task polling runner for media adapters.
 */

export interface AsyncTaskRunnerOptions<TPoll, TResult> {
  taskLabel: string;
  timeoutMs: number;
  getPollDelayMs: (attempt: number) => number;
  poll: (attempt: number) => Promise<TPoll>;
  isSucceeded: (payload: TPoll) => boolean;
  mapResult: (payload: TPoll) => TResult | Promise<TResult>;
  isFailed?: (payload: TPoll) => boolean;
  getFailureMessage?: (payload: TPoll) => string;
  getTimeoutMessage?: (attempts: number) => string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runAsyncTaskWithPolling<TPoll, TResult>(
  options: AsyncTaskRunnerOptions<TPoll, TResult>,
): Promise<TResult> {
  const {
    taskLabel,
    timeoutMs,
    getPollDelayMs,
    poll,
    isSucceeded,
    mapResult,
    isFailed,
    getFailureMessage,
    getTimeoutMessage,
  } = options;

  const deadline = Date.now() + timeoutMs;
  let attempts = 0;

  while (Date.now() < deadline) {
    await sleep(getPollDelayMs(attempts));
    const payload = await poll(attempts);

    if (isFailed?.(payload)) {
      const message = getFailureMessage?.(payload) || `${taskLabel} failed`;
      throw new Error(message);
    }

    if (isSucceeded(payload)) {
      return mapResult(payload);
    }

    attempts += 1;
  }

  if (getTimeoutMessage) {
    throw new Error(getTimeoutMessage(attempts));
  }

  throw new Error(`${taskLabel} timed out after ${Math.floor(timeoutMs / 1000)}s`);
}
