/**
 * Static suggestion catalog — the on-device copy of the Suggestion content.
 *
 * In production this cache is refreshed in the background via
 * GET /suggestions?stage=&gestationalWeek=&deliveryWindowActive=
 * (calendar-home-screens §5, B4). For this slice the catalog is static;
 * the background refresh is a carry-forward.
 *
 * Gate rule (api-contract): the server only returns items with
 * clinical_signoff AND NOT verify_flag. This catalog mirrors that gate —
 * no WEAK evidence items are included (suggestion-flow-ui.md §3).
 *
 * Ordering within each stage: HIGH evidence entries first, then STRONG, then
 * MODERATE. The engine also sorts by evidence strength (see suggestionEngine.ts).
 *
 * Evidence sources (suggestion-flow-ui.md §2.1 ribbon):
 *   กรมอนามัย — Department of Health, Thailand (RTCOG-aligned)
 *   WHO        — World Health Organization
 *
 * i18n: suggestion titles and reason text are in the messages catalog under
 * 'suggestion.<key>.title' and 'suggestion.<key>.reason'.
 */

import type { SuggestionCatalogEntry } from './types';

export const SUGGESTION_CATALOG: readonly SuggestionCatalogEntry[] = [
  // ── T3 / week ≥ 28 ───────────────────────────────────────────────────────

  /**
   * Kick counting — fetal movement tracking (HIGH evidence, [KICK]).
   * startWeek aligned to 32 to match shouldShowModule (kickCountLogic.ts) and
   * HomeScreen's wk≥32 gate (spec §4 / D6 / SC-K6a). Routing the suggestion to
   * a module that the app treats as not-yet-available before wk 32 would produce
   * a dead action. Note: กรมอนามัย recommends monitoring from wk 28 — if the spec
   * is later updated to show the module from wk 28, lower this gate to match.
   */
  {
    key: 'kick_count_start',
    captureTarget: 'kick_count',
    applicableLifecycles: ['pregnant'],
    applicableStages: ['T3'],
    startWeek: 32,
    evidenceStrength: 'HIGH',
    source: 'กรมอนามัย',
  },

  // ── All pregnant stages ───────────────────────────────────────────────────

  /**
   * Iron + folic acid supplement (Triferdine 150) daily.
   * Standard ANC supplement protocol throughout pregnancy (STRONG evidence).
   */
  {
    key: 'triferdine_daily',
    captureTarget: 'medication',
    applicableLifecycles: ['pregnant'],
    applicableStages: ['T1', 'T2', 'T3'],
    evidenceStrength: 'STRONG',
    source: 'กรมอนามัย',
  },

  // ── Stage-specific ANC appointments ──────────────────────────────────────

  /**
   * First ANC visit — T1 (STRONG evidence).
   * กรมอนามัย recommends ≥ 5 ANC visits; the first is in T1.
   */
  {
    key: 'anc_t1_checkup',
    captureTarget: 'appointment',
    applicableLifecycles: ['pregnant'],
    applicableStages: ['T1'],
    evidenceStrength: 'STRONG',
    source: 'กรมอนามัย',
  },

  /**
   * Second-trimester ANC visit — T2 (STRONG evidence).
   */
  {
    key: 'anc_t2_checkup',
    captureTarget: 'appointment',
    applicableLifecycles: ['pregnant'],
    applicableStages: ['T2'],
    evidenceStrength: 'STRONG',
    source: 'กรมอนามัย',
  },

  /**
   * Third-trimester ANC visit — T3 (STRONG evidence).
   */
  {
    key: 'anc_t3_checkup',
    captureTarget: 'appointment',
    applicableLifecycles: ['pregnant'],
    applicableStages: ['T3'],
    evidenceStrength: 'STRONG',
    source: 'กรมอนามัย',
  },

  /**
   * Supplies checklist — prepare before birth (MODERATE evidence, common practice).
   * Relevant from week 28 onward so there's time to gather items.
   */
  {
    key: 'supplies_checklist',
    captureTarget: 'supplies',
    applicableLifecycles: ['pregnant'],
    applicableStages: ['T3'],
    startWeek: 28,
    evidenceStrength: 'MODERATE',
    source: 'กรมอนามัย',
  },

  // ── Postpartum ────────────────────────────────────────────────────────────

  /**
   * Postnatal check-up — 6-week follow-up appointment (STRONG evidence).
   */
  {
    key: 'postnatal_checkup',
    captureTarget: 'appointment',
    applicableLifecycles: ['postpartum'],
    applicableStages: [],
    evidenceStrength: 'STRONG',
    source: 'กรมอนามัย',
  },

  /**
   * Baby feeding log — track feeding sessions (MODERATE, WHO best practice).
   */
  {
    key: 'baby_feeding_log',
    captureTarget: 'self_log',
    applicableLifecycles: ['postpartum'],
    applicableStages: [],
    evidenceStrength: 'MODERATE',
    source: 'WHO',
  },
];
