/**
 * deviceCalendarQueue — bounded on-device retry queue for transient write failures.
 *
 * Architecture §7.6: on transient failure (not permission/consent failure),
 * the failed entry is enqueued and retried on next app-foreground / reconnect.
 *
 * Simple in-memory queue with a bounded size cap. Injectable for tests.
 * The queue holds ops (create/update/delete) keyed by appointmentId.
 * Trace: architecture §7.6, functional §5.3 (partial-failure handling).
 * SECURITY: queue entries hold only appointmentId + op type (no health content).
 */

export type QueuedOpType = 'upsert' | 'delete' | 'remask';

export interface QueuedOp {
  appointmentId: string;
  opType:        QueuedOpType;
  /** ISO timestamp when this op was enqueued. */
  enqueuedAt:    string;
  /** Number of retry attempts so far. */
  attempts:      number;
}

/** Maximum number of queued ops before we drop new enqueues (bounded — arch §7.6). */
const MAX_QUEUE_SIZE = 50;

export function createDeviceCalendarQueue() {
  const _ops: Map<string, QueuedOp> = new Map();

  return {
    enqueue(appointmentId: string, opType: QueuedOpType): void {
      if (_ops.size >= MAX_QUEUE_SIZE) return; // bounded; surface needs-attention
      const existing = _ops.get(appointmentId);
      _ops.set(appointmentId, {
        appointmentId,
        opType,
        enqueuedAt:  existing?.enqueuedAt ?? new Date().toISOString(),
        attempts:    (existing?.attempts ?? 0) + 1,
      });
    },

    dequeue(appointmentId: string): QueuedOp | undefined {
      const op = _ops.get(appointmentId);
      _ops.delete(appointmentId);
      return op;
    },

    peek(appointmentId: string): QueuedOp | undefined {
      return _ops.get(appointmentId);
    },

    all(): QueuedOp[] {
      return Array.from(_ops.values());
    },

    remove(appointmentId: string): void {
      _ops.delete(appointmentId);
    },

    clear(): void {
      _ops.clear();
    },

    size(): number {
      return _ops.size;
    },

    isFull(): boolean {
      return _ops.size >= MAX_QUEUE_SIZE;
    },
  };
}

export type DeviceCalendarQueue = ReturnType<typeof createDeviceCalendarQueue>;
