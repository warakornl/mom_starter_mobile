import { v5 as uuidv5 } from 'uuid';
import { computeOccurrenceId, OCCURRENCE_NAMESPACE } from './occurrenceId';

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

  // 🟡-3 CANONICAL-LOWERCASE rule: uppercase reminderId MUST produce the same id
  // as lowercase, because the server normalises to lowercase before recomputing.
  // If client sent uppercase and server compared against lowercase the ids would
  // diverge → done/snoozed stranded in rejected[] (permanent adherence-data loss).
  it('🟡-3: uppercase reminderId produces the SAME id as lowercase (canonical-lowercase rule)', () => {
    const lower = computeOccurrenceId(
      '4328078f-6339-4c38-a2ce-eabff6cbf387',
      '2026-07-15T10:30',
    );
    const upper = computeOccurrenceId(
      '4328078F-6339-4C38-A2CE-EABFF6CBF387',
      '2026-07-15T10:30',
    );
    const mixed = computeOccurrenceId(
      '4328078f-6339-4C38-a2ce-EABFF6CBF387',
      '2026-07-15T10:30',
    );
    expect(upper).toBe(lower);
    expect(mixed).toBe(lower);
  });

  it('uses the frozen OCCURRENCE_NAMESPACE constant (any change breaks cross-platform parity)', () => {
    expect(OCCURRENCE_NAMESPACE).toBe('4328078f-6339-4c38-a2ce-eabff6cbf387');
  });

  it('pipe delimiter prevents concatenation aliasing', () => {
    // "ab|cd" and "a|bcd" must produce different ids even though concat is same
    const id1 = computeOccurrenceId('ab', 'cd');
    const id2 = computeOccurrenceId('a', 'bcd');
    expect(id1).not.toBe(id2);
  });
});
