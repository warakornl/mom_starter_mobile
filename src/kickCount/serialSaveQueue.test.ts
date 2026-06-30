/**
 * serialSaveQueue tests — TDD (failing first).
 *
 * Y-5: validates that the serial queue:
 *   - serializes concurrent writes (FIFO order)
 *   - returns the right error when a write fails
 *   - recovers after a failure (chain not permanently stuck)
 *   - calling order matches persistence order
 *
 * Y-3: validates that on success the write-phase resolves correctly,
 *   and on failure the error propagates (no stale-closure re-read).
 */

import { createSerialSaveQueue } from './serialSaveQueue';

describe('createSerialSaveQueue()', () => {
  it('executes a single write and resolves', async () => {
    const enqueue = createSerialSaveQueue();
    let called = false;
    await enqueue(async () => { called = true; });
    expect(called).toBe(true);
  });

  it('serializes two concurrent writes — second runs after first finishes', async () => {
    const enqueue = createSerialSaveQueue();
    const order: number[] = [];

    let resolveFirst!: () => void;
    const firstWrite = new Promise<void>((res) => { resolveFirst = res; });

    const p1 = enqueue(() => firstWrite.then(() => { order.push(1); }));
    const p2 = enqueue(async () => { order.push(2); });

    // At this point, firstWrite is pending and secondWrite is queued after
    expect(order).toHaveLength(0);

    resolveFirst(); // unblock first write
    await Promise.all([p1, p2]);

    // Second write must run AFTER first write
    expect(order).toEqual([1, 2]);
  });

  it('Y-5: rapid calls preserve FIFO order (simulates rapid tap+tap)', async () => {
    const enqueue = createSerialSaveQueue();
    const recorded: number[] = [];
    const delays = [30, 10, 20]; // intentionally non-monotonic

    const promises = delays.map((delay, i) =>
      enqueue(
        () =>
          new Promise<void>((res) => {
            setTimeout(() => {
              recorded.push(i);
              res();
            }, delay);
          }),
      ),
    );

    await Promise.all(promises);
    // Even though delays are out of order, enqueue order must be preserved
    expect(recorded).toEqual([0, 1, 2]);
  });

  it('Y-3: success path resolves (no stale closure — caller gets clean resolution)', async () => {
    const enqueue = createSerialSaveQueue();
    let error: unknown = undefined;
    try {
      await enqueue(async () => { /* success */ });
    } catch (e) {
      error = e;
    }
    expect(error).toBeUndefined();
  });

  it('Y-3: failure propagates to caller (save-error state set correctly)', async () => {
    const enqueue = createSerialSaveQueue();
    const err = new Error('keychain_locked');
    await expect(enqueue(() => Promise.reject(err))).rejects.toThrow('keychain_locked');
  });

  it('chain recovers after a failed write — subsequent writes still execute', async () => {
    const enqueue = createSerialSaveQueue();
    const order: string[] = [];

    await enqueue(() => Promise.reject(new Error('fail1'))).catch(() => {});
    await enqueue(async () => { order.push('after-fail'); });

    expect(order).toEqual(['after-fail']);
  });

  it('two independent instances do not share queue state', async () => {
    const enqueueA = createSerialSaveQueue();
    const enqueueB = createSerialSaveQueue();
    const order: string[] = [];

    await Promise.all([
      enqueueA(async () => { order.push('A'); }),
      enqueueB(async () => { order.push('B'); }),
    ]);

    expect(order.length).toBe(2);
    // Order between A and B is not guaranteed, but both ran
    expect(order).toContain('A');
    expect(order).toContain('B');
  });
});
