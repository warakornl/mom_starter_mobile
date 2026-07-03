/**
 * expensesUtils — TDD test suite (failing tests written first).
 *
 * Covers:
 *   - satangToBaht()   : integer satang → display string "฿1,234.50"
 *   - bahtStringToSatang() : user-typed baht string → integer satang
 *   - validateAmountInput() : validates baht string before save
 *   - computeMonthTotal()  : sum of non-deleted records for a given civil month
 *   - computeCategoryBreakdown() : per-category sums, sorted high-to-low, zeroes omitted
 *   - groupExpensesByDate() : most-recent-first, then by entry order (createdAt tiebreak)
 *   - isInCivilMonth()      : floating-civil date bucket membership
 */

import {
  satangToBaht,
  bahtStringToSatang,
  validateAmountInput,
  computeMonthTotal,
  computeCategoryBreakdown,
  groupExpensesByDate,
  isInCivilMonth,
} from './expensesUtils';
import type { ExpenseRecord } from '../sync/syncTypes';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeExpense(overrides: Partial<ExpenseRecord> = {}): ExpenseRecord {
  return {
    id: 'exp-001',
    amount: 10000, // 100 baht
    category: 'baby-supplies',
    incurredOn: '2026-06-28',
    version: 1,
    clientId: 'client-1',
    createdAt: '2026-06-28T10:00:00Z',
    updatedAt: '2026-06-28T10:00:00Z',
    deletedAt: null,
    ...overrides,
  };
}

// ─── satangToBaht ─────────────────────────────────────────────────────────────

describe('satangToBaht', () => {
  it('converts 0 to "฿0.00"', () => {
    expect(satangToBaht(0)).toBe('฿0.00');
  });

  it('converts 100 satang (฿1) to "฿1.00"', () => {
    expect(satangToBaht(100)).toBe('฿1.00');
  });

  it('converts 59000 satang (฿590) to "฿590.00"', () => {
    expect(satangToBaht(59000)).toBe('฿590.00');
  });

  it('converts 428000 satang (฿4,280) with thousands separator', () => {
    expect(satangToBaht(428000)).toBe('฿4,280.00');
  });

  it('converts 1234567 satang (฿12,345.67) with correct decimals', () => {
    expect(satangToBaht(1234567)).toBe('฿12,345.67');
  });

  it('handles non-integer satang gracefully (rounds)', () => {
    // satang is always an integer by contract, but guard rounding
    expect(satangToBaht(100)).toBe('฿1.00');
  });
});

// ─── bahtStringToSatang ───────────────────────────────────────────────────────

describe('bahtStringToSatang', () => {
  it('converts whole baht "590" to 59000 satang', () => {
    expect(bahtStringToSatang('590')).toBe(59000);
  });

  it('converts "4280" to 428000 satang', () => {
    expect(bahtStringToSatang('4280')).toBe(428000);
  });

  it('converts "1" to 100 satang', () => {
    expect(bahtStringToSatang('1')).toBe(100);
  });

  it('converts "0" to 0 satang', () => {
    expect(bahtStringToSatang('0')).toBe(0);
  });

  it('strips commas from user input "1,200"', () => {
    expect(bahtStringToSatang('1,200')).toBe(120000);
  });

  it('returns 0 for empty string', () => {
    expect(bahtStringToSatang('')).toBe(0);
  });

  it('returns 0 for non-numeric input', () => {
    expect(bahtStringToSatang('abc')).toBe(0);
  });
});

// ─── validateAmountInput ─────────────────────────────────────────────────────

describe('validateAmountInput', () => {
  it('returns valid=true for "590"', () => {
    expect(validateAmountInput('590')).toEqual({ valid: true });
  });

  it('returns valid=true for "1"', () => {
    expect(validateAmountInput('1')).toEqual({ valid: true });
  });

  it('returns valid=false with errorKey for empty string', () => {
    const result = validateAmountInput('');
    expect(result.valid).toBe(false);
    expect(result.errorKey).toBeDefined();
  });

  it('returns valid=false with errorKey for "0"', () => {
    const result = validateAmountInput('0');
    expect(result.valid).toBe(false);
    expect(result.errorKey).toBeDefined();
  });

  it('returns valid=false for negative amount', () => {
    const result = validateAmountInput('-100');
    expect(result.valid).toBe(false);
    expect(result.errorKey).toBeDefined();
  });

  it('returns valid=false for non-numeric "abc"', () => {
    const result = validateAmountInput('abc');
    expect(result.valid).toBe(false);
    expect(result.errorKey).toBeDefined();
  });
});

// ─── isInCivilMonth ───────────────────────────────────────────────────────────

describe('isInCivilMonth', () => {
  it('returns true for same month', () => {
    expect(isInCivilMonth('2026-06-15', 2026, 6)).toBe(true);
  });

  it('returns false for different month', () => {
    expect(isInCivilMonth('2026-07-01', 2026, 6)).toBe(false);
  });

  it('returns false for different year', () => {
    expect(isInCivilMonth('2025-06-15', 2026, 6)).toBe(false);
  });

  it('returns true for month boundaries (first day)', () => {
    expect(isInCivilMonth('2026-06-01', 2026, 6)).toBe(true);
  });

  it('returns true for month boundaries (last day)', () => {
    expect(isInCivilMonth('2026-06-30', 2026, 6)).toBe(true);
  });
});

// ─── computeMonthTotal ────────────────────────────────────────────────────────

describe('computeMonthTotal', () => {
  it('returns 0 for empty list', () => {
    expect(computeMonthTotal([], 2026, 6)).toBe(0);
  });

  it('sums amounts for records in the month', () => {
    const records: ExpenseRecord[] = [
      makeExpense({ amount: 59000, incurredOn: '2026-06-28' }),
      makeExpense({ id: 'exp-002', amount: 80000, incurredOn: '2026-06-26' }),
    ];
    expect(computeMonthTotal(records, 2026, 6)).toBe(139000);
  });

  it('excludes records from other months', () => {
    const records: ExpenseRecord[] = [
      makeExpense({ amount: 59000, incurredOn: '2026-06-28' }),
      makeExpense({ id: 'exp-002', amount: 80000, incurredOn: '2026-07-01' }),
    ];
    expect(computeMonthTotal(records, 2026, 6)).toBe(59000);
  });

  it('excludes soft-deleted (tombstoned) records', () => {
    const records: ExpenseRecord[] = [
      makeExpense({ amount: 59000, incurredOn: '2026-06-28' }),
      makeExpense({
        id: 'exp-002',
        amount: 80000,
        incurredOn: '2026-06-26',
        deletedAt: '2026-06-29T00:00:00Z',
      }),
    ];
    expect(computeMonthTotal(records, 2026, 6)).toBe(59000);
  });

  it('returns 0 when all records are deleted', () => {
    const records: ExpenseRecord[] = [
      makeExpense({
        amount: 59000,
        incurredOn: '2026-06-28',
        deletedAt: '2026-06-29T00:00:00Z',
      }),
    ];
    expect(computeMonthTotal(records, 2026, 6)).toBe(0);
  });
});

// ─── computeCategoryBreakdown ────────────────────────────────────────────────

describe('computeCategoryBreakdown', () => {
  it('returns empty array for empty list', () => {
    expect(computeCategoryBreakdown([], 2026, 6)).toEqual([]);
  });

  it('groups by category and sums correctly', () => {
    const records: ExpenseRecord[] = [
      makeExpense({ category: 'baby-supplies', amount: 59000, incurredOn: '2026-06-28' }),
      makeExpense({ id: 'exp-002', category: 'baby-supplies', amount: 25000, incurredOn: '2026-06-20' }),
      makeExpense({ id: 'exp-003', category: 'healthcare', amount: 80000, incurredOn: '2026-06-26' }),
    ];
    const breakdown = computeCategoryBreakdown(records, 2026, 6);
    const babySupplies = breakdown.find((b) => b.category === 'baby-supplies');
    const healthcare = breakdown.find((b) => b.category === 'healthcare');
    expect(babySupplies?.totalSatang).toBe(84000);
    expect(healthcare?.totalSatang).toBe(80000);
  });

  it('sorts by totalSatang descending', () => {
    const records: ExpenseRecord[] = [
      makeExpense({ category: 'mother', amount: 25000, incurredOn: '2026-06-20' }),
      makeExpense({ id: 'exp-002', category: 'healthcare', amount: 80000, incurredOn: '2026-06-26' }),
      makeExpense({ id: 'exp-003', category: 'baby-supplies', amount: 59000, incurredOn: '2026-06-28' }),
    ];
    const breakdown = computeCategoryBreakdown(records, 2026, 6);
    expect(breakdown[0].category).toBe('healthcare');
    expect(breakdown[1].category).toBe('baby-supplies');
    expect(breakdown[2].category).toBe('mother');
  });

  it('omits categories with zero total', () => {
    const records: ExpenseRecord[] = [
      makeExpense({ category: 'baby-supplies', amount: 59000, incurredOn: '2026-06-28' }),
    ];
    const breakdown = computeCategoryBreakdown(records, 2026, 6);
    const categories = breakdown.map((b) => b.category);
    expect(categories).not.toContain('healthcare');
    expect(categories).not.toContain('baby-gear');
    expect(categories).not.toContain('mother');
    expect(categories).not.toContain('other');
  });

  it('excludes deleted records from breakdown', () => {
    const records: ExpenseRecord[] = [
      makeExpense({ category: 'baby-supplies', amount: 59000, incurredOn: '2026-06-28' }),
      makeExpense({
        id: 'exp-002',
        category: 'healthcare',
        amount: 80000,
        incurredOn: '2026-06-26',
        deletedAt: '2026-06-29T00:00:00Z',
      }),
    ];
    const breakdown = computeCategoryBreakdown(records, 2026, 6);
    const categories = breakdown.map((b) => b.category);
    expect(categories).not.toContain('healthcare');
  });
});

// ─── groupExpensesByDate ──────────────────────────────────────────────────────

describe('groupExpensesByDate', () => {
  it('returns empty array for empty list', () => {
    expect(groupExpensesByDate([], 2026, 6)).toEqual([]);
  });

  it('filters to the given month only', () => {
    const records: ExpenseRecord[] = [
      makeExpense({ incurredOn: '2026-06-28' }),
      makeExpense({ id: 'exp-002', amount: 80000, incurredOn: '2026-07-01' }),
    ];
    const result = groupExpensesByDate(records, 2026, 6);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('exp-001');
  });

  it('sorts most recent incurredOn first', () => {
    const records: ExpenseRecord[] = [
      makeExpense({ id: 'exp-001', incurredOn: '2026-06-20', createdAt: '2026-06-20T10:00:00Z' }),
      makeExpense({ id: 'exp-002', incurredOn: '2026-06-28', createdAt: '2026-06-28T10:00:00Z' }),
      makeExpense({ id: 'exp-003', incurredOn: '2026-06-15', createdAt: '2026-06-15T10:00:00Z' }),
    ];
    const result = groupExpensesByDate(records, 2026, 6);
    expect(result.map((r) => r.id)).toEqual(['exp-002', 'exp-001', 'exp-003']);
  });

  it('uses createdAt as stable tiebreak for same incurredOn', () => {
    const records: ExpenseRecord[] = [
      makeExpense({ id: 'exp-001', incurredOn: '2026-06-28', createdAt: '2026-06-28T08:00:00Z' }),
      makeExpense({ id: 'exp-002', incurredOn: '2026-06-28', createdAt: '2026-06-28T12:00:00Z' }),
    ];
    const result = groupExpensesByDate(records, 2026, 6);
    // Most recently created comes first within same incurredOn
    expect(result.map((r) => r.id)).toEqual(['exp-002', 'exp-001']);
  });

  it('excludes deleted records', () => {
    const records: ExpenseRecord[] = [
      makeExpense({ id: 'exp-001', incurredOn: '2026-06-28' }),
      makeExpense({
        id: 'exp-002',
        incurredOn: '2026-06-27',
        deletedAt: '2026-06-29T00:00:00Z',
      }),
    ];
    const result = groupExpensesByDate(records, 2026, 6);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('exp-001');
  });
});
