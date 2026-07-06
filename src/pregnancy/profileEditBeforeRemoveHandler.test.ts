/**
 * profileEditBeforeRemoveHandler.test.ts — TDD tests for AC-15.
 *
 * Covers the "unsaved-changes guard" (edit-pregnancy-profile-behavior.md §4.5):
 *   - backing out with unsaved changes prompts a discard confirmation
 *   - backing out with no changes is silent (no prompt)
 *   - confirm-discard navigates away (dispatches the pending action)
 *   - keep-editing dismisses the dialog without dispatching
 *   - a successful save clears the dirty flag so goBack after save is silent
 *
 * Tests the pure `buildBeforeRemoveHandler` function extracted from
 * ProfileEditScreen — injectable alertFn + dispatch so tests run in node
 * without React Native modules.
 */

import { buildBeforeRemoveHandler } from './profileEditBeforeRemoveHandler';
import type { AlertButton, BeforeRemoveEvent } from './profileEditBeforeRemoveHandler';

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeEvent(actionType = 'GO_BACK'): BeforeRemoveEvent {
  return {
    preventDefault: jest.fn(),
    data: { action: { type: actionType } },
  };
}

// Pass-through identity t() function — keys become the "translated" string.
const t = (key: string) => key;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('buildBeforeRemoveHandler — AC-15 unsaved-changes guard', () => {
  it('dirty=false: beforeRemove does NOT prevent navigation or show Alert', () => {
    const isDirtyRef = { current: false };
    const alertFn = jest.fn();
    const dispatch = jest.fn();
    const event = makeEvent();

    const handler = buildBeforeRemoveHandler(isDirtyRef, alertFn, dispatch, t);
    handler(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(alertFn).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('dirty=true: beforeRemove prevents navigation and shows discard Alert', () => {
    const isDirtyRef = { current: true };
    const alertFn = jest.fn();
    const dispatch = jest.fn();
    const event = makeEvent();

    const handler = buildBeforeRemoveHandler(isDirtyRef, alertFn, dispatch, t);
    handler(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(alertFn).toHaveBeenCalledTimes(1);
  });

  it('dirty=true: Alert uses the correct profile.editDiscard* i18n keys', () => {
    const isDirtyRef = { current: true };
    const alertFn = jest.fn();
    const dispatch = jest.fn();
    const event = makeEvent();

    const handler = buildBeforeRemoveHandler(isDirtyRef, alertFn, dispatch, t);
    handler(event);

    const [title, message, buttons] = alertFn.mock.calls[0] as [
      string,
      string,
      AlertButton[],
    ];
    expect(title).toBe('profile.editDiscardTitle');
    expect(message).toBe('profile.editDiscardBody');

    const cancelBtn = buttons.find((b) => b.style === 'cancel');
    const confirmBtn = buttons.find((b) => b.style === 'destructive');
    expect(cancelBtn?.text).toBe('profile.editDiscardCancel');
    expect(confirmBtn?.text).toBe('profile.editDiscardConfirm');
  });

  it('dirty=true + confirm discard → clears isDirtyRef.current and dispatches the action', () => {
    const isDirtyRef = { current: true };
    const alertFn = jest.fn();
    const dispatch = jest.fn();
    const event = makeEvent('POP');

    const handler = buildBeforeRemoveHandler(isDirtyRef, alertFn, dispatch, t);
    handler(event);

    const buttons = alertFn.mock.calls[0][2] as AlertButton[];
    const confirmBtn = buttons.find((b) => b.style === 'destructive');
    expect(confirmBtn).toBeDefined();
    confirmBtn!.onPress!();

    expect(isDirtyRef.current).toBe(false); // dirty cleared
    expect(dispatch).toHaveBeenCalledWith(event.data.action);
  });

  it('dirty=true + keep-editing (cancel) → isDirtyRef unchanged, dispatch NOT called', () => {
    const isDirtyRef = { current: true };
    const alertFn = jest.fn();
    const dispatch = jest.fn();
    const event = makeEvent();

    const handler = buildBeforeRemoveHandler(isDirtyRef, alertFn, dispatch, t);
    handler(event);

    const buttons = alertFn.mock.calls[0][2] as AlertButton[];
    const cancelBtn = buttons.find((b) => b.style === 'cancel');
    expect(cancelBtn).toBeDefined();
    cancelBtn!.onPress?.(); // cancel button may or may not have onPress

    expect(isDirtyRef.current).toBe(true); // still dirty — user chose keep-editing
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('save-success path: isDirtyRef cleared → beforeRemove is silent (no Alert)', () => {
    const isDirtyRef = { current: true };
    const alertFn = jest.fn();
    const dispatch = jest.fn();
    const event = makeEvent();

    // Simulate: save completes → handleSave clears isDirtyRef before calling goBack
    isDirtyRef.current = false;

    const handler = buildBeforeRemoveHandler(isDirtyRef, alertFn, dispatch, t);
    handler(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(alertFn).not.toHaveBeenCalled();
  });

  it('the handler is callable multiple times with the same isDirtyRef', () => {
    const isDirtyRef = { current: false };
    const alertFn = jest.fn();
    const dispatch = jest.fn();

    const handler = buildBeforeRemoveHandler(isDirtyRef, alertFn, dispatch, t);

    // First call: not dirty — no alert
    handler(makeEvent());
    expect(alertFn).not.toHaveBeenCalled();

    // Mark dirty (user edits a field)
    isDirtyRef.current = true;

    // Second call: dirty — alert shown
    handler(makeEvent());
    expect(alertFn).toHaveBeenCalledTimes(1);
  });
});
