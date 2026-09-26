import { logger } from './logger.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Retry an async fn with exponential backoff + full jitter.
 * `shouldRetry(err, attempt)` decides recoverability. Returns the last result
 * or throws the last error when all attempts are exhausted.
 */
export async function retry(fn, {
  retries = 4,
  baseDelayMs = 300,
  maxDelayMs = 8000,
  factor = 2,
  label = 'op',
  shouldRetry = () => true,
  onRetry,
} = {}) {
  let lastErr;
  const total = retries + 1; // first try + retries
  for (let attempt = 1; attempt <= total; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const recoverable = attempt < total && shouldRetry(err, attempt);
      if (!recoverable) {
        logger.warn(`${label}: giving up after ${attempt} attempt(s)`, {
          error: err && err.message,
        });
        throw err;
      }
      const capped = Math.min(maxDelayMs, baseDelayMs * Math.pow(factor, attempt - 1));
      const delay = Math.round(capped / 2 + Math.random() * (capped / 2)); // full jitter
      logger.info(`${label}: attempt ${attempt} failed (${err && err.message}); retrying in ${delay}ms`);
      if (onRetry) { try { onRetry(err, attempt, delay); } catch { /* noop */ } }
      await sleep(delay);
    }
  }
  throw lastErr;
}
