/**
 * profileEditBeforeRemoveHandler — pure factory for the React Navigation
 * `beforeRemove` listener that guards against silently discarding unsaved edits.
 *
 * AC-15 (edit-pregnancy-profile-behavior.md §4.5):
 *   "If the user changed the date/week/method but has not saved, show a confirm
 *    on back: 'ทิ้งการแก้ไข?' / 'ยกเลิก / ทิ้ง'."
 *
 * Design: pure function with no React Native imports — alertFn and dispatch are
 * injected so this module is fully testable in the node/ts-jest environment.
 * ProfileEditScreen passes `Alert.alert` as alertFn and `navigation.dispatch`
 * as dispatch when registering the listener via `useEffect`.
 *
 * i18n keys consumed:
 *   profile.editDiscardTitle   — dialog title   "ทิ้งการแก้ไข?"
 *   profile.editDiscardBody    — dialog message  "การเปลี่ยนแปลงที่ยังไม่ได้บันทึกจะถูกลบ"
 *   profile.editDiscardCancel  — keep-editing    "ยกเลิก"
 *   profile.editDiscardConfirm — confirm discard "ทิ้ง"
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

export type AlertFn = (
  title: string,
  message: string,
  buttons: AlertButton[],
) => void;

export interface BeforeRemoveEvent {
  preventDefault(): void;
  data: { action: BeforeRemoveAction };
}

export type BeforeRemoveAction = Readonly<{ type: string }>;

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Returns a `beforeRemove` event listener that implements the AC-15 dirty guard.
 *
 * @param isDirtyRef    Mutable ref — true iff the user made at least one field change.
 * @param alertFn       Injectable alert function (production: Alert.alert from RN).
 * @param dispatch      Injectable navigation dispatch (production: navigation.dispatch).
 * @param t             i18n translation function.
 * @returns             A handler suitable for `navigation.addListener('beforeRemove', …)`.
 */
export function buildBeforeRemoveHandler(
  isDirtyRef: { current: boolean },
  alertFn: AlertFn,
  dispatch: (action: BeforeRemoveAction) => void,
  t: (key: string) => string,
): (e: BeforeRemoveEvent) => void {
  return (e) => {
    // Not dirty — let navigation proceed naturally.
    if (!isDirtyRef.current) {
      return;
    }

    // Dirty — intercept and ask the user.
    e.preventDefault();

    alertFn(
      t('profile.editDiscardTitle'),
      t('profile.editDiscardBody'),
      [
        {
          text: t('profile.editDiscardCancel'),
          style: 'cancel',
          // No onPress: RN Alert dismisses on cancel tap by default.
        },
        {
          text: t('profile.editDiscardConfirm'),
          style: 'destructive',
          onPress: () => {
            // User confirmed discard — clear dirty flag and let navigation proceed.
            isDirtyRef.current = false;
            dispatch(e.data.action);
          },
        },
      ],
    );
  };
}
