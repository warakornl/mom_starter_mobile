/**
 * Style-token assertions for KickCountCountingScreen timer prominence.
 *
 * TDD guard: these tests encode the INTENDED visual hierarchy for the elapsed
 * timer after the "timer more prominent" enhancement.  They run purely against
 * exported style-token constants (no component rendering required).
 *
 * Hierarchy contract:
 *  1. countNumber  — 56 pt weight-700 #1A1A1A  (hero — untouched by this slice)
 *  2. timerText    — 32 pt monospace  #3D3D3D  (strong secondary)
 *  3. timerLabel   — 14 pt            #6B6B6B  (caption)
 */

import { timerStyleTokens } from './kickCountTimerStyleTokens';

describe('KickCountCountingScreen — timer style tokens (prominence)', () => {
  describe('timerText', () => {
    it('has fontSize 32 (prominent secondary, clearly smaller than hero 56)', () => {
      expect(timerStyleTokens.timerFontSize).toBe(32);
    });

    it('color is #3D3D3D (readable ink, visibly darker than old #6B6B6B)', () => {
      expect(timerStyleTokens.timerColor).toBe('#3D3D3D');
    });

    it('timerText fontSize is strictly less than countNumber hero fontSize (56)', () => {
      expect(timerStyleTokens.timerFontSize).toBeLessThan(
        timerStyleTokens.countHeroFontSize,
      );
    });
  });

  describe('timerLabel', () => {
    it('has fontSize 14 (slightly larger than old 13 for readability)', () => {
      expect(timerStyleTokens.timerLabelFontSize).toBe(14);
    });

    it('color is #6B6B6B (ink/soft — clearer than old #9B9B9B faint)', () => {
      expect(timerStyleTokens.timerLabelColor).toBe('#6B6B6B');
    });
  });

  describe('visual hierarchy invariant', () => {
    it('timerText fontSize < countNumber fontSize (timer must not overpower hero)', () => {
      expect(timerStyleTokens.timerFontSize).toBeLessThan(
        timerStyleTokens.countHeroFontSize,
      );
    });

    it('timerLabel fontSize <= timerText fontSize (label smaller than value)', () => {
      expect(timerStyleTokens.timerLabelFontSize).toBeLessThanOrEqual(
        timerStyleTokens.timerFontSize,
      );
    });
  });
});
