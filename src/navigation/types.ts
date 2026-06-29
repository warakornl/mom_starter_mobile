/**
 * Navigation param list for the root stack.
 *
 * Route params:
 *   Welcome       — no params (landing screen)
 *   Login         — no params
 *   Register      — no params
 *   VerifyEmail   — email: address shown in check-inbox screen
 *   Home          — no params (dashboard; checks profile lifecycle on mount)
 *   ProfileSetup  — no params (initial pregnancy profile setup — first-run or GET 404)
 *   BirthEvent    — profileVersion: current profile version (for If-Match header)
 *
 * Navigation flow:
 *   Login/VerifyEmail success → Home
 *   Home (GET 404 profile) → ProfileSetup (via onNeedsProfile callback)
 *   ProfileSetup complete → Home (via onSetupComplete callback + navigation.reset)
 *   Home T3 banner "ลูกคลอดแล้ว" → BirthEvent (via onBirthEvent(version))
 *   BirthEvent success → Home (via onBirthRecorded + navigation.reset)
 *
 * Deep-link carry-forward:
 *   VerifyEmail will also receive `pendingToken?: string` once Expo Linking
 *   is wired up (momstarter://verify?token=...).
 */
export type RootStackParamList = {
  Welcome: undefined;
  Login: undefined;
  Register: undefined;
  VerifyEmail: { email: string; pendingToken?: string };
  Home: undefined;
  ProfileSetup: undefined;
  /** Birth event screen — records birth and transitions lifecycle to postpartum. */
  BirthEvent: { profileVersion: number };
};
