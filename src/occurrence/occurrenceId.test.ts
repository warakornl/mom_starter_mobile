import { v5 as uuidv5 } from 'uuid';
import { computeOccurrenceId } from './occurrenceId';

describe('occurrence id', () => {
  // RFC 4122 known vector — same one the backend asserts, proving cross-stack parity.
  it('uuidv5 matches the RFC 4122 known vector (parity with backend)', () => {
    const DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    expect(uuidv5('www.example.com', DNS)).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });

  it('is deterministic', () => {
    expect(computeOccurrenceId('rem-123', '2026-06-28T08:00')).toBe(
      computeOccurrenceId('rem-123', '2026-06-28T08:00'),
    );
  });

  it('distinct reminder or civil time yields distinct id', () => {
    const base = computeOccurrenceId('rem-123', '2026-06-28T08:00');
    expect(computeOccurrenceId('rem-999', '2026-06-28T08:00')).not.toBe(base);
    expect(computeOccurrenceId('rem-123', '2026-06-28T08:01')).not.toBe(base);
  });
});
