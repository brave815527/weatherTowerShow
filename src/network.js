"use strict";
async function fetchJson(
  url,
  { timeoutMs = 8000, fetchImpl = fetch, signal, retries = 1 } = {},
) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const combined = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);
    try {
      const response = await fetchImpl(url, {
        signal: combined,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        const error = new Error(`HTTP_${response.status}`);
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      return await response.json();
    } catch (error) {
      if (signal?.aborted || attempt === retries || error.retryable === false)
        throw new Error(signal?.aborted ? "CANCELLED" : "UPSTREAM_UNAVAILABLE");
      await new Promise((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          reject(new Error("CANCELLED"));
        };
        const timer = setTimeout(
          () => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
          },
          250 * 2 ** attempt,
        );
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) onAbort();
      });
    }
  }
}
module.exports = { fetchJson };
