import { config } from '../config.js';
import { retry } from './retry.js';
import { logger } from './logger.js';

export class HttpError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

/** True for statuses worth retrying (transient server/ rate-limit problems). */
function retryableStatus(s) {
  return s === 408 || s === 425 || s === 429 || (s >= 500 && s <= 599);
}

/**
 * fetch with timeout + retry, tuned for the deliberately-flaky mock store.
 * Returns the raw Response on success; throws HttpError/TimeoutError otherwise.
 */
export async function httpFetch(url, {
  method = 'GET',
  headers = {},
  timeoutMs = config.httpTimeoutMs,
  retries = config.httpRetries,
  signal,
} = {}) {
  return retry(async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
    if (signal) {
      if (signal.aborted) ctrl.abort(signal.reason);
      else signal.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
    }
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'User-Agent': config.userAgent,
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          ...headers,
        },
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const err = new HttpError(res.status, url, body.slice(0, 300));
        err.retryable = retryableStatus(res.status);
        throw err;
      }
      return res;
    } catch (err) {
      // network failure / abort / timeout are all retryable
      if (err && err.name === 'AbortError') {
        const t = new Error(`timeout after ${timeoutMs}ms: ${url}`);
        t.retryable = true;
        throw t;
      }
      if (err && err.retryable === undefined) err.retryable = true;
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }, {
    retries,
    label: `http ${method} ${url}`,
    shouldRetry: (err) => err?.retryable !== false,
  });
}

export async function httpJson(url, opts = {}) {
  const res = await httpFetch(url, opts);
  return res.json();
}
