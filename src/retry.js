const BASE_DELAY_MS = 400;
const MAX_DELAY_MS = 20_000;

const TRANSPORT_PATTERN =
  /\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR|fetch failed|network|terminated|socket hang up)\b/i;

function isTransportFailure(error) {
  return TRANSPORT_PATTERN.test(
    `${error?.name ?? ''} ${error?.message ?? ''} ${error?.cause?.code ?? ''} ${error?.cause?.message ?? ''}`
  );
}

/**
 * Decide whether a failure is worth another attempt, and name the reason so the
 * caller can say what it is waiting on.
 *
 * @param {unknown} error
 * @returns {string | null} Retry reason, or null to give up.
 */
export function classifyRetry(error) {
  // A declined prompt, a malformed request, or dead credentials all fail the
  // same way every time — retrying only burns the user's quota and patience.
  if (error?.retryable === false) {
    return null;
  }
  if (error?.retryable === true) {
    return error.code ?? 'retryable';
  }
  if (error?.code === 'RATE_LIMITED') {
    return 'rate limited';
  }
  if (error?.code === 'MISSING_IMAGE_GENERATION_OUTPUT') {
    return 'stream carried no image';
  }
  if (error?.code === 'HTTP_ERROR' && error.status >= 500 && error.status < 600) {
    return `HTTP ${error.status}`;
  }
  if (error?.code === 'MALFORMED_SSE_JSON') {
    return 'malformed stream';
  }
  if (isTransportFailure(error)) {
    return 'transport failure';
  }
  return null;
}

/**
 * Exponential backoff with jitter, so parallel callers do not retry in lockstep.
 *
 * @param {number} attempt 1 for the first retry.
 * @returns {number}
 */
export function retryDelayMs(attempt) {
  // Jitter before clamping, so the cap is a real ceiling rather than something
  // the randomization can overshoot.
  const backoff = BASE_DELAY_MS * 2 ** (attempt - 1);
  return Math.round(Math.min(MAX_DELAY_MS, backoff * (0.85 + Math.random() * 0.3)));
}

/**
 * Run an operation, retrying only the failures that a retry can actually fix.
 *
 * @param {() => Promise<T>} run
 * @param {{ retries?: number, onRetry?: (info: { attempt: number, retries: number, reason: string, delayMs: number }) => void, sleep?: (ms: number) => Promise<void> }} [options]
 * @returns {Promise<T>}
 * @template T
 */
export async function withRetries(run, { retries = 0, onRetry, sleep = defaultSleep } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run(attempt);
    } catch (error) {
      const reason = classifyRetry(error);
      if (!reason || attempt >= retries) {
        throw error;
      }

      const delayMs = retryDelayMs(attempt + 1);
      onRetry?.({ attempt: attempt + 1, retries, reason, delayMs });
      await sleep(delayMs);
    }
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
