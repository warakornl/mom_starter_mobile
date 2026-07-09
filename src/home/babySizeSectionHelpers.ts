/**
 * babySizeSectionHelpers.ts — Pure helper functions for BabySizeSection.
 *
 * Extracted from the component so they are testable in the node test environment
 * (testEnvironment: 'node') without React Native.
 *
 * S4 invariant: all functions in this file accept ONLY civil-date derived data
 * (PostpartumAge, which comes from computePostpartumAge(birthDate, today)).
 * No mother-entered health field (weight/BP/symptoms/self-log) can reach here.
 * Ref: legal §5 S4, §7.2 — input-whitelist invariant.
 *
 * S6/S7 Invariant (legal §5 CR-1 — Milk Code / no-ad-targeting):
 * postpartumDays / postpartumWeek / postpartumMonth MUST NEVER be wired into
 * any ad selection, product recommendation, or infant-feeding content path.
 * This file is display-only. Do NOT export age values for use in ad/product
 * selection, feeding-introduction, or any targeting logic.
 * Refs: legal §5 S6/S7, CR-1 (Milk Code temporal targeting), register Z-13.
 */

import type { PostpartumAge } from '../pregnancy/postpartumAge';

/**
 * Format the postpartum age for display in BabySizeSection's primary line.
 *
 * Age display thresholds (design §6.2):
 *   day 0          → "ลูกน้อยเพิ่งคลอด" / "Baby just arrived"
 *   1–6 days       → "ลูกน้อยอายุ {n} วัน" / "Baby is {n} day(s) old"
 *   7–29 days      → weeks format (gate: m=floor(d/30)=0 avoids "0 เดือน" display)
 *   30+ days       → months format (m = floor(days/30) ≥ 1)
 *
 * Month formula (design §6.2): m = Math.floor(postpartumDays / 30), r = postpartumDays − m × 30.
 *
 * S4: accepts only PostpartumAge (civil-date derived) — no health fields.
 */
export function formatPostpartumAgeForSection(
  pp: PostpartumAge,
  locale: 'th' | 'en',
): string {
  const { postpartumDays, postpartumWeek, postpartumDay } = pp;

  // Day 0 — birth day
  if (postpartumDays === 0) {
    return locale === 'th' ? 'ลูกน้อยเพิ่งคลอด' : 'Baby just arrived';
  }

  // 1–6 days — day format
  if (postpartumDays < 7) {
    if (locale === 'th') {
      return `ลูกน้อยอายุ ${postpartumDays} วัน`;
    }
    const dayWord = postpartumDays === 1 ? 'day' : 'days';
    return `Baby is ${postpartumDays} ${dayWord} old`;
  }

  // 7–29 days — weeks format
  // Gate: floor(days/30) = 0 for days 7–29, so months would give "0 เดือน X วัน"
  if (postpartumDays < 30) {
    if (postpartumDay === 0) {
      if (locale === 'th') {
        return `ลูกน้อยอายุ ${postpartumWeek} สัปดาห์`;
      }
      const wkWord = postpartumWeek === 1 ? 'week' : 'weeks';
      return `Baby is ${postpartumWeek} ${wkWord} old`;
    }
    if (locale === 'th') {
      return `ลูกน้อยอายุ ${postpartumWeek} สัปดาห์ ${postpartumDay} วัน`;
    }
    const wkWord = postpartumWeek === 1 ? 'week' : 'weeks';
    const dayWord2 = postpartumDay === 1 ? 'day' : 'days';
    return `Baby is ${postpartumWeek} ${wkWord} ${postpartumDay} ${dayWord2} old`;
  }

  // 30+ days — months format (m ≥ 1 guaranteed)
  const m = Math.floor(postpartumDays / 30);
  const r = postpartumDays - m * 30;

  if (r === 0) {
    if (locale === 'th') {
      return `ลูกน้อยอายุ ${m} เดือน`;
    }
    const moWord = m === 1 ? 'month' : 'months';
    return `Baby is ${m} ${moWord} old`;
  }

  if (locale === 'th') {
    return `ลูกน้อยอายุ ${m} เดือน ${r} วัน`;
  }
  const moWord2 = m === 1 ? 'month' : 'months';
  const dayWord3 = r === 1 ? 'day' : 'days';
  return `Baby is ${m} ${moWord2} ${r} ${dayWord3} old`;
}
