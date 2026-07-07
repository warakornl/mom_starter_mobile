/**
 * Navigation param list for the root stack.
 *
 * Route params:
 *   Welcome       — no params (landing screen)
 *   Login         — no params
 *   Register      — no params
 *   VerifyEmail   — email: address shown in check-inbox screen
 *   MainTabs      — no params; renders BottomTabNavigator (5 tabs; initial = Home)
 *   ProfileSetup  — no params (initial pregnancy profile setup — first-run or GET 404)
 *   BirthEvent    — profileVersion: current profile version (for If-Match header)
 *
 * Navigation flow v2 (bottom-tab-navigation-design.md §1.1):
 *   Login/VerifyEmail success → MainTabs (Home tab opens by default)
 *   HomeTab (GET 404 profile) → ProfileSetup (via onNeedsProfile; tab bar suppressed)
 *   ProfileSetup complete → MainTabs (via onSetupComplete callback + navigation.reset)
 *   HomeTab T3 banner "ลูกคลอดแล้ว" → BirthEvent (via onBirthEvent(version))
 *   BirthEvent success → MainTabs (via onBirthRecorded + navigation.reset)
 *   HomeTab "รายงานสำหรับแพทย์ ›" row → DoctorReport (root-stack screen §8A)
 *   CalendarTab renders CalendarScreen directly (no wrapper per §3A)
 *   CalendarScreen → AppointmentForm / ReminderForm (stack-pushed over tabs)
 *
 * Tabs (inside BottomTabNavigator — not separate stack routes):
 *   Supplies, Expenses, Home (center), Calendar, Medication
 *   Doctor Report is now a root-stack screen, not a tab.
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

  /**
   * MainTabs — the 5-tab bottom navigator (BottomTabNavigator).
   * Replaces the former 'Home' route. Contains: Supplies, Expenses,
   * Home (center, initial), Calendar, Medication.
   * Profile snapshot is hosted in PregnancyProfileContext above this route.
   *
   * `screen` param allows deep-linking to a specific tab from outside
   * the tab navigator (e.g. SuggestionFlowScreen's "Start" CTA that routes
   * to the Supplies or Calendar tab). Matches the React Navigation v6
   * nested-navigator `navigate('MainTabs', { screen: 'Supplies' })` pattern.
   */
  MainTabs: { screen?: 'Supplies' | 'Expenses' | 'Home' | 'Calendar' | 'Medication' | 'Profile' } | undefined;

  /**
   * DoctorReport — root-stack screen hosting DoctorPdfScreen (v2 §8A).
   * Entered via HomeTab "รายงานสำหรับแพทย์ ›" row; replaces the former Report tab.
   * No params — health data is read from PregnancyProfileContext (PDPA SD-9).
   * §report-edd-guard: screen guards against the 2999-12-31 sentinel EDD.
   */
  DoctorReport: undefined;

  ProfileSetup: undefined;
  /** Birth event screen — records birth and transitions lifecycle to postpartum. */
  BirthEvent: { profileVersion: number };

  /**
   * AppointmentForm — add/edit a ChecklistItem with category=appointment.
   * itemId present → edit mode; absent → create mode.
   * Stack-pushed over the tabs from CalendarTabScreen.
   */
  AppointmentForm: { itemId?: string; defaultCategory?: string };

  /**
   * AncAppointmentForm — AppointmentFormScreen opened from the ANC cadence
   * suggestion Start tap, pre-filled with the AncFormPrefill payload.
   *
   * NO route params — the prefill is health-adjacent (computed from EDD) and
   * must NOT go into route params (PDPA SD-9). RootNavigator holds the prefill
   * in a useRef and injects it at the screen render level (same pattern as
   * how kick-count screens receive edd/gestationalWeek from context, not params).
   *
   * INV-A4: nothing is written until the mother taps Save in the form.
   */
  AncAppointmentForm: undefined;

  /**
   * ReminderForm — add/edit a Reminder with recurrenceRule (FLAG-4 grammar).
   * reminderId present → edit mode; absent → create mode.
   * Stack-pushed over the tabs from CalendarTabScreen.
   */
  ReminderForm: { reminderId?: string };

  /**
   * Settings — account/settings menu.
   * Entry: gear ⚙ in the Home tab top bar (v2 §3.2 — moved from Calendar).
   * Stack-pushed over the tabs.
   */
  Settings: undefined;

  /**
   * ProfileEdit — edit-pregnancy-profile host screen.
   *
   * Entry: Settings > "แก้ไขข้อมูลการตั้งครรภ์" (shown only when lifecycle=pregnant).
   * On mount: GETs a fresh profile (carries version + eddBasis, absent from snapshot).
   * No params — the fresh-GET result is held in the host's local state (PDPA SD-9).
   * On 200 save: goBack() to Settings (NOT reset-to-Home — AC-7 / R-2).
   * On 401 (GET or PUT, no-token or server): performLogout teardown → Welcome (AC-13).
   *
   * See edit-pregnancy-profile-behavior.md §10.1 build mandates.
   */
  ProfileEdit: undefined;

  /**
   * Consent — S3 first-run PDPA consent screen.
   * Entry: after VerifyEmail (new registrations only).
   * No params — uses tokenStorage from context / props.
   */
  Consent: undefined;

  /**
   * ManageConsents — S8 Manage-Consents screen (PDPA ม.19 withdrawal).
   * Entry: Settings > Manage Permissions.
   * Lists all 6 consent purposes with toggle grant/withdraw.
   */
  ManageConsents: undefined;

  // ── Kick Count — stack-pushed over tabs ─────────────────────────────────────
  /**
   * KickCountHome — SC-K0: module entry.
   * Entry (pregnant wk≥32): kick-count card in Calendar tab dashboard (§4.2).
   */
  KickCountHome: undefined;
  /**
   * KickCountCounting — SC-K1: the active counting screen.
   * Only navigated-to after consent gate passes and draft is created.
   */
  KickCountCounting: undefined;
  /**
   * KickCountSummary — SC-K3: post-finalize session summary.
   * sessionId identifies the just-completed local row.
   */
  KickCountSummary: { sessionId: string };
  /**
   * KickCountHistory — SC-K4: history list of completed sessions.
   * Entry (postpartum): quiet history link in Calendar tab dashboard (§4.3, direct entry).
   * Entry (pregnant): from KickCountHome.
   */
  KickCountHistory: undefined;
  /**
   * KickCountDetail — SC-K5: read-only session detail.
   * sessionId = id of the local completed KickCountSessionRecord.
   */
  KickCountDetail: { sessionId: string };

  /**
   * Suggestions — full stage-scoped suggestion list (suggestion-flow-ui.md).
   * Entry: SuggestionBanner "View all" in Calendar tab dashboard.
   * Shows suggestion cards with Start / Snooze / Dismiss actions.
   */
  Suggestions: undefined;

  /**
   * Capture — Quick Capture / Self-log form (capture-ui.md).
   * Entry: Day-Detail "Add" / specific-context reminder / Medication "Log dose".
   * Stack-pushed over the tabs.
   *
   * Security: NO health values in route params (PDPA SD-9). Plan ID is a UUID.
   */
  Capture: {
    metricType?: import('../sync/syncTypes').SelfLogMetricType;
    loggedAtDate?: string;
    defaultTime?: string;
    medicationPlanId?: string;
  };
};
