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
   * ForgotPassword (S5) — email-entry screen for password reset.
   *
   * prefillEmail: optional email from LoginScreen's current field value
   * (convenience — mother doesn't retype; no security impact).
   *
   * Auth: unauthenticated. No token params.
   */
  ForgotPassword: { prefillEmail?: string } | undefined;

  /**
   * ResetPassword — set-new-password screen reached via email deep-link.
   *
   * SD-9 / MI-1 / appsec F-1 ratified: NO route params carry the reset token.
   * The token is held in a module-level useRef in RootNavigator (ancPrefillRef
   * pattern) and injected at render time. This prevents the token from entering
   * React Navigation's serialised state, debug tooling breadcrumbs, or any
   * persisted storage. Route params here remain undefined.
   *
   * Auth: unauthenticated.
   */
  ResetPassword: undefined;

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
   * LossConfirm — Screen B: two-step pregnancy-loss confirmation.
   *
   * Entry: ProfileEdit (Account ▸ Pregnancy) quiet entry link, shown ONLY
   * when lifecycle === 'pregnant' (INV-ENTRY-2). No deep-link, no push
   * (LOSS-INV-9) — this screen is reachable ONLY via that in-app tap.
   *
   * `profileVersion` is a plain number (If-Match version only) — NOT health
   * data, consistent with SD-9 (no health VALUES travel via route params).
   *
   * On confirm success: POST /pregnancy-profile/loss-event → lifecycle:'ended'.
   * pregnancy-loss-recording-ui.md §3 / functional-spec §14.
   */
  LossConfirm: { profileVersion: number };

  /**
   * ReopenConfirm — Screen C: reopen (correction) confirmation.
   *
   * Entry: ProfileHubScreen quiet reopen entry, shown ONLY when
   * lifecycle === 'ended' (mobile-reviewer BLOCKER-1 fix — mutually
   * exclusive in intent with LossConfirm's entry, pregnancy-loss-recording-
   * ui.md §4.1, but the reopen entry now lives in ProfileHub, not
   * ProfileEditScreen, because ProfileEditScreen is gated pregnant-only
   * (AC-2) and can never render for an 'ended' profile). Always available,
   * no expiry (AC-4.3).
   *
   * NO route params — SD-9: this screen performs its own GET on mount
   * (mirrors ProfileInfoEditScreen's lifecycle-agnostic pattern) to obtain
   * the authoritative profile + version, rather than depending on a caller
   * that may not have a fresh version available.
   *
   * On confirm success: POST /pregnancy-profile/reopen → lifecycle:'pregnant',
   * loss_date cleared (S4). pregnancy-loss-recording-ui.md §4 / functional-spec §15.
   */
  ReopenConfirm: undefined;

  /**
   * ProfileInfoEdit — edit mother first/last name + optional baby name.
   *
   * Entry: ProfileHubScreen > "แก้ไขชื่อ / ข้อมูลส่วนตัว" row (lifecycle-agnostic).
   * On mount: GETs a fresh profile (name cipher fields absent from snapshot).
   * No params — PDPA SD-9: no health/name data in route params.
   * On 200 save: goBack() to ProfileHub; the hub summary refreshes on focus via snapshot.
   * On 401 (GET or PUT): performLogout teardown → Welcome (SD-5).
   *
   * See name-fields-design.md §3.4 / profile-tab-and-hub-ui.md §3.4.
   */
  ProfileInfoEdit: undefined;

  /**
   * PregnancySummary — read-only pregnancy recap screen (trimester + delivery).
   *
   * Entry: ProfileHubScreen > "สรุปการตั้งครรภ์" row (lifecycle-agnostic:
   * shown for BOTH pregnant and postpartum profiles).
   *
   * SD-9 / PDPA: params = undefined — health data (edd, birthDate,
   * deliveryType, hospitalAdmissionDate, hospitalDischargeDate) is NEVER
   * passed in route params. The screen obtains its inputs by performing a
   * GET /v1/pregnancy-profile on mount and decoding cipher fields client-side
   * (mirror of ProfileInfoEditScreen GET-on-mount pattern).
   *
   * SD-5: GET 401 → full performLogout teardown → Welcome.
   *
   * See docs/product/pregnancy-summary.md §3.2 / pregnancy-summary-design.md §2.
   */
  PregnancySummary: undefined;

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

  /**
   * PrivacyPolicy — task #40. Entry: ManageConsents footer "นโยบายความเป็นส่วนตัว" link.
   *
   * No params — SD-9: static content only, no health data.
   *
   * NOTE: no lawyer-approved final privacy-policy copy exists in the repo yet
   * (legal-register.md §Z-5 is an open gate). This screen is an HONEST
   * "in progress" placeholder — NOT invented legal text. See
   * PrivacyPolicyScreen.tsx doc comment for the investigation trail.
   */
  PrivacyPolicy: undefined;

  /**
   * ConsentHistory — task #40. Entry: ManageConsents footer "ประวัติความยินยอม" link.
   *
   * No params — SD-9: the screen performs its own GET /v1/account/consents
   * on mount (mirrors ManageConsentsScreen's hydrate-on-mount pattern) rather
   * than receiving consent records via route params.
   *
   * Real, read-only history view backed by the real endpoint (already wired
   * via consentApiClient.getConsents) — NOT an in-memory fake.
   */
  ConsentHistory: undefined;

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

  // ── Device Calendar Sync (Approach A) ──────────────────────────────────────
  /**
   * CalendarSyncSettings — CS-4 device-calendar sync hub screen.
   * Entry: Settings > "ซิงก์ปฏิทินในเครื่อง" OR AppointmentDetail "เพิ่มลงปฏิทิน"
   *        (when consent already exists) OR ManageConsents calendar_sync row (consented).
   *
   * SD-9: no health data in params. Feature state is read from deviceCalendarSettings
   * on mount (not passed as params).
   */
  CalendarSyncSettings: undefined;

  /**
   * CalendarSyncConsent — CS-1 in-app consent + explainer sheet.
   * Entry: CalendarSyncSettings (toggle ON, no consent) OR ManageConsents (not consented)
   *        OR AppointmentDetail "เพิ่มลงปฏิทิน" (first time, no consent).
   *
   * SD-9: no health data in params. Consent text version is read from a constant.
   * explainer-before-prompt: requestCalendarPermissionsAsync must NOT be called
   * until this sheet is shown AND grant tapped (CAL-SCR-10).
   */
  CalendarSyncConsent: undefined;

  /**
   * CalendarSyncPrivacyLevel — CS-5 privacy level control screen.
   * Entry: CalendarSyncSettings > privacy row.
   * SD-9: no health data in params.
   */
  CalendarSyncPrivacyLevel: undefined;

  /**
   * AutoDecrementSettings — Screen 1: configure which activities auto-decrement
   * which supply items. Entry: Supplies tab "ตั้งค่าตัดสต็อกอัตโนมัติ ›" button.
   * No params — config data read from consumptionMappingStore on mount.
   */
  AutoDecrementSettings: undefined;

  /**
   * SubUnitSetup — Screen 2: configure usesPerContainer for a supply item.
   * Entry: AutoDecrementSettings when usesPerContainer < 2 (D-4 advisory deep-link).
   *
   * SD-9: supplyItemId is a UUID only — NO health values or item data in route params.
   * Screen reads item from supplySyncStore.getSupplyItem(supplyItemId) on render.
   */
  SubUnitSetup: { supplyItemId: string };

  /**
   * SupplyItemPicker — "Link an item" destination from AutoDecrementSettings.
   * Entry: AutoDecrementSettings "+ เชื่อมต่อของใช้" affordance per activity section.
   *
   * SD-9: activityType is a closed 3-value string enum (MappingActivityType) —
   * NOT health data. No supply item data or health values in route params;
   * the screen reads supply items from supplySyncStore on render.
   *
   * Tapping an item on this screen enqueues a new ConsumptionMappingRecord via
   * consumptionMappingStore.enqueueCreate (Bug #2 fix — the only production
   * caller of enqueueCreate).
   */
  SupplyItemPicker: { activityType: import('../sync/syncTypes').MappingActivityType };

  /**
   * FeedingLog — Screen 3: feeding-log surface.
   * Records a feeding event with kind ∈ {breastfeed, pump, formula}.
   * Formula kind triggers the T-F auto-stock-decrement path.
   * Entry: Supplies tab "บันทึกการให้นม ›" button.
   *
   * No params — SD-9: no health values in route params. All data read from
   * stores on render. Consent checked at write path (SD-10 dual-gate).
   *
   * INV-ASD-8: usesRemainingInOpenContainer never in route params or session record.
   * FW-1: formula copy = verbatim item name + integers + neutral verbs only.
   */
  FeedingLog: undefined;
};
