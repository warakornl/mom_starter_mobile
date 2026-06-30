/**
 * serialSaveQueue — a simple serial promise queue for kick-count draft writes.
 *
 * Y-5: rapid taps create concurrent saveDraft() calls. Without serialization,
 * two writes may resolve out-of-order, letting an older count overwrite the
 * newer one (Keychain write race). This queue ensures one write completes before
 * the next one starts, preserving count ordering.
 *
 * Usage:
 *   const enqueue = createSerialSaveQueue();
 *   await enqueue(() => saveDraft(updated)); // always waits for prior write
 *
 * Guarantees:
 *   - Writes execute in enqueue order (FIFO, one at a time).
 *   - A failed write does NOT block subsequent writes (the chain recovers).
 *   - Returned promise resolves/rejects with the result of `writeFn`.
 *
 * Security: no health data stored here — only the write function is queued.
 */

/**
 * Factory: returns an `enqueue` function that serializes async write calls.
 * Callers create one instance per component lifetime (via useRef).
 *
 * @returns `enqueue(writeFn)` — schedules writeFn after all prior writes finish.
 *   Throws (rejects) if writeFn throws, so callers can catch and show save-error.
 */
export function createSerialSaveQueue(): (writeFn: () => Promise<void>) => Promise<void> {
  let queue: Promise<void> = Promise.resolve();

  return function enqueue(writeFn: () => Promise<void>): Promise<void> {
    // Chain onto the existing queue regardless of whether it succeeded.
    // `.then(fn, fn)` means: run writeFn after previous resolves OR rejects.
    // This ensures the queue is never permanently stuck after a write failure.
    const next: Promise<void> = queue.then(writeFn, () => writeFn());

    // Keep the chain reference alive but swallow so the ref itself never rejects.
    // (The caller's `await enqueue(...)` still gets the real error.)
    queue = next.then(
      () => {},
      () => {},
    );

    return next;
  };
}
