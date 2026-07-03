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
 *   Home calendar button → Calendar
 *   Calendar → AppointmentForm (new: no params; edit: itemId)
 *   Calendar → ReminderForm   (new: no params; edit: reminderId)
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
  /**
   * Supplies screen — offline-first supply checklist (sync engine slice 1).
   * Entry: shortcut button on HomeScreen.
   */
  Supplies: undefined;
  /**
   * Expenses screen — offline-first monthly expense ledger (expenses-feature).
   * Entry: shortcut button on HomeScreen.
   * amount stored as satang integer; displayed as ฿ with 2 decimals.
   */
  Expenses: undefined;
  /**
   * Calendar screen — month/agenda combining appointments + reminder occurrences.
   * Entry: "ดูทั้งหมด" / calendar button on HomeScreen.
   */
  Calendar: undefined;
  /**
   * AppointmentForm — add/edit a ChecklistItem with category=appointment.
   * itemId present → edit mode; absent → create mode.
   */
  AppointmentForm: { itemId?: string; defaultCategory?: string };
  /**
   * ReminderForm — add/edit a Reminder with recurrenceRule (FLAG-4 grammar).
   * reminderId present → edit mode; absent → create mode.
   */
  ReminderForm: { reminderId?: string };
  /**
   * Settings — account/settings menu. Home for logout (kept two levels deep so it
   * can't be triggered by accident). Entry: gear ⚙ in the Home header.
   */
  Settings: undefined;

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

  // ── Kick Count ──────────────────────────────────────────────────────────────
  /**
   * KickCountHome — SC-K0: module entry (wk≥32+pregnant only).
   * Week gate and consent gate enforced inside the screen.
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
   * Accessible from SC-K0 and SC-K3; read-only for postpartum.
   */
  KickCountHistory: undefined;
  /**
   * KickCountDetail — SC-K5: read-only session detail.
   * sessionId = id of the local completed KickCountSessionRecord.
   */
  KickCountDetail: { sessionId: string };

  /**
   * Suggestions — full stage-scoped suggestion list (suggestion-flow-ui.md).
   * Entry: SuggestionBanner "View all" on HomeScreen.
   * Shows suggestion cards with Start / Snooze / Dismiss actions.
   */
  Suggestions: undefined;

  /**
   * DoctorPdf — Builder→Preview→Share screen for the doctor-summary PDF.
   * Entry: "รายงานสำหรับแพทย์" button on HomeScreen (both pregnant & postpartum).
   * Spec: pdf-doctor-ui.md §1–§5.
   * No health data in route params (PDPA SD-9).
   */
  DoctorPdf: undefined;

  /**
   * Capture — Quick Capture / Self-log form (capture-ui.md).
   * Entry: Day-Detail "Add" / Home shortcut / specific-context reminder.
   *
   * metricType: if present, type control is hidden and pre-set.
   *             if absent, the type segmented control is shown (generic "Add").
   * loggedAtDate: YYYY-MM-DD of the day being logged (default = today).
   * defaultTime:  HH:mm override (e.g. from a reminder occurrence time).
   *              If absent: now on today / 12:00 on non-today (capture-ui §2).
   *
   * Security: NO health values in route params (PDPA SD-9).
   */
  Capture: {
    metricType?: import('../sync/syncTypes').SelfLogMetricType;
    loggedAtDate?: string;
    defaultTime?: string;
  };
};
