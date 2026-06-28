import { dedupOccurrences } from './dedup';
import { computeOccurrenceId } from '../occurrence/occurrenceId';

describe('occurrence dedup', () => {
  it('collapses a projected and a materialized instance with the same id into one', () => {
    const id = computeOccurrenceId('rem-abc', '2026-06-15T08:00');
    const projected = { id, materialized: false, source: 'projected' };
    const materialized = { id, materialized: true, source: 'materialized' };

    const result = dedupOccurrences([projected, materialized]);
    expect(result).toHaveLength(1);
    expect(result[0].materialized).toBe(true); // materialized wins
  });

  it('keeps distinct ids', () => {
    const a = { id: computeOccurrenceId('rem-a', '2026-06-15T08:00') };
    const b = { id: computeOccurrenceId('rem-b', '2026-06-15T08:00') };
    expect(dedupOccurrences([a, b])).toHaveLength(2);
  });
});
