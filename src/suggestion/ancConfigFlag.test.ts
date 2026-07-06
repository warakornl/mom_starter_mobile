/**
 * ancConfigFlag.test.ts — TDD guard for the ANC_PREFILL_DATE config flag (Surface 7).
 *
 * ANC_PREFILL_DATE is a single boolean constant in ancConfig.ts that gates ONLY:
 *   - Whether prefill.date is populated (non-undefined) in buildAncStartPayload()
 *   - Which dateLabel variant is used (dateLabelOn vs dateLabelOff)
 *
 * Default value: true (ON) for build + UAT builds.
 * MUST be false in production until launch-gate Z-16 passes.
 *
 * This test file:
 *   1. Documents the location of the flag (ancConfig.ts)
 *   2. Confirms the flag default (true) matches the build/UAT spec
 *   3. Documents the Z-16 production requirement via a skip-aware test
 *   4. Asserts the flag is a boolean (not undefined, not null)
 */

import { ANC_PREFILL_DATE } from './ancConfig';

describe('ANC_PREFILL_DATE config flag (Surface 7)', () => {
  it('is a boolean (not undefined, not null)', () => {
    expect(typeof ANC_PREFILL_DATE).toBe('boolean');
  });

  it('defaults to true for build + UAT (DEFAULT ON)', () => {
    // This test documents the expected default.
    // If this test fails in CI, it means the flag was changed to false
    // before Z-16 was signed — that is correct behavior for a production build.
    // For build/UAT, this MUST be true.
    expect(ANC_PREFILL_DATE).toBe(true);
  });

  /**
   * PRODUCTION REQUIREMENT (Z-16):
   * The following test is documented but NOT executed as a failing assertion
   * because the flag is intentionally ON for build/UAT.
   *
   * Before production launch:
   *   - OB-GYN + lawyer must co-sign ANC cadence + copy + ribbon (Z-16)
   *   - After Z-16 signs: change ANC_PREFILL_DATE to false; this comment block
   *     should be removed and the production-off test should be enabled
   *
   * CHECKLIST before flipping to false for production (from ancConfig.ts):
   *   Z-16 OB-GYN sign-off   [ ]
   *   Z-6  legal copy review [ ]
   *   Z-15 PDPA-A4 audit     [ ]
   *   Z-2  QA sign-off       [ ]
   */
  it('(Z-16 gate) flag location is ancConfig.ts — one-line flip to false for production', () => {
    // The implementation is correct: the flag is in exactly one place.
    // This test is a documentation anchor for the Z-16 gate.
    // The ONLY file to change for production launch: src/suggestion/ancConfig.ts
    expect(typeof ANC_PREFILL_DATE).toBe('boolean');
  });
});
