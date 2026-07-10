/**
 * tokens.motherRoom.phase2.test.ts
 *
 * TDD guard: Phase 2 input component tokens exist on T and have correct values.
 * These tests must go RED before the Phase 2 input tokens are added to tokens.ts,
 * and GREEN after.
 *
 * All values come from the Phase 2 rollout spec §0.1.
 */

import { T } from './tokens';

describe('T.input — Phase 2 component tokens', () => {
  it('T.input.bg is ivory-200 (#F5EDE6)', () => {
    expect(T.input.bg).toBe('#F5EDE6');
  });

  it('T.input.text is roselle-900 (#4A2230)', () => {
    expect(T.input.text).toBe('#4A2230');
  });

  it('T.input.placeholder is roselle-700 (#7A3A52)', () => {
    expect(T.input.placeholder).toBe('#7A3A52');
  });

  it('T.input.border.default is surface.divider (#E8DDD5)', () => {
    expect(T.input.border.default).toBe('#E8DDD5');
  });

  it('T.input.border.focused is amber-600 (#B8720E)', () => {
    expect(T.input.border.focused).toBe('#B8720E');
  });

  it('T.input.border.error is roselle-500 (#B85C78) — form validation only, NOT error-700', () => {
    expect(T.input.border.error).toBe('#B85C78');
    // Must NOT be error-700 (#8B2020 — clinical escalation only)
    expect(T.input.border.error).not.toBe('#8B2020');
  });

  it('T.input.errorText is roselle-700 (#7A3A52)', () => {
    expect(T.input.errorText).toBe('#7A3A52');
  });

  it('T.input.height is 52', () => {
    expect(T.input.height).toBe(52);
  });

  it('T.input.bg matches T.color.surface.subtle', () => {
    expect(T.input.bg).toBe(T.color.surface.subtle);
  });

  it('T.input.text matches T.color.text.heading', () => {
    expect(T.input.text).toBe(T.color.text.heading);
  });

  it('T.input.placeholder matches T.color.text.primary', () => {
    expect(T.input.placeholder).toBe(T.color.text.primary);
  });

  it('T.input.errorText matches T.color.text.primary (roselle-700)', () => {
    expect(T.input.errorText).toBe(T.color.text.primary);
  });

  it('T.input.border.error must not be jade-600 (R4 — jade fails AA below 15sp)', () => {
    expect(T.input.border.error).not.toBe('#4A7A5C');
  });
});
