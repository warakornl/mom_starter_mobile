/**
 * Navigation param list for the root stack.
 *
 * Route params:
 *   Welcome      — no params (landing screen)
 *   Login        — no params
 *   Register     — no params
 *   VerifyEmail  — email: the address the user registered with (display + resend)
 *   Home         — no params (post-auth placeholder dashboard)
 *
 * Deep-link carry-forward:
 *   VerifyEmail will also receive `pendingToken?: string` once Expo Linking
 *   is wired up (momstarter://verify?token=...). The navigator will extract
 *   the token from the URL and pass it via route.params.
 */
export type RootStackParamList = {
  Welcome: undefined;
  Login: undefined;
  Register: undefined;
  VerifyEmail: { email: string; pendingToken?: string };
  Home: undefined;
};
