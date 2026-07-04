# Account Rights — QA Traceability Matrix

Spec roots: account-rights-behavior.md, delete-account-reauth-ruling.md, US-25/26/27.
E2E flows: .maestro/22–25.
Unit suites: src/accountRights/ (7 suites, **184 tests** total as of this document).

Legend: COVERED = automated test exists | E2E = Maestro flow | MANUAL = device-only gate | GAP = not yet automated

---

## Export (GET /v1/account/export) — AR-AC-01..08, 22..25

| ID | Criterion | Coverage | Evidence |
|----|-----------|----------|----------|
| AR-AC-01 | "Download my data" row visible on Settings | E2E | flow 22, flow 25 |
| AR-AC-02 | Export request sends no userId in path/query/body | COVERED | accountApiClient.test.ts |
| AR-AC-03 | Export request carries Authorization: Bearer header | COVERED | accountApiClient.test.ts |
| AR-AC-04 | Export 200 → file written + OS share sheet opened | COVERED | exportOrchestration.test.ts (happy path) |
| AR-AC-05 | Export network error → EXPORT_ERROR (calm, no data loss) | COVERED | exportOrchestration.test.ts |
| AR-AC-06 | Export timeout → EXPORT_ERROR | COVERED | exportOrchestration.test.ts |
| AR-AC-07 | Export 401 → EXPORT_ERROR (token expired path) | COVERED | exportOrchestration.test.ts + accountApiClient.test.ts (mapExport401) |
| AR-AC-08 | Export 404 (account soft-deleted) → EXPORT_UNAVAILABLE_404 (terminal, no retry) | COVERED | exportOrchestration.test.ts |
| AR-AC-22 | Export response body never logged or rendered by the app | COVERED | exportOrchestration.test.ts (bodyText passed raw to fileService) |
| AR-AC-23 | Export file written to app-private cache dir | COVERED | accountExportFileService.test.ts |
| AR-AC-24 | Raw JSON passed to saveAndShare without parsing | COVERED | exportOrchestration.test.ts |
| AR-AC-25 | Nav-away during export → EXPORT_IDLE silently (no error surfaced) | COVERED | exportOrchestration.test.ts (request_aborted→IDLE mapping); signal-wired abort in accountApiClient.test.ts |

---

## Delete account (DELETE /v1/account) — AR-AC-09..21

| ID | Criterion | Coverage | Evidence |
|----|-----------|----------|----------|
| AR-AC-09 | Tap "Delete my account" row → sheet opens; confirm button disabled until floor satisfied | E2E | flow 23 (floor gate); accountRightsController.test.ts (confirm enabled only when floor met) |
| AR-AC-10 | NONE device: step-up skipped; DELETE proceeds on floor alone | COVERED | deleteFlowLogic.test.ts (NONE device paths) |
| AR-AC-11 | Enrolled device (any level): step-up required before DELETE | COVERED | deleteFlowLogic.test.ts (SECRET=1, BIOMETRIC_WEAK=2, BIOMETRIC_STRONG=3) |
| AR-AC-12 | Biometric/passcode prompt shown to user (OS native) | MANUAL | flow 23 DEVICE-ONLY LAUNCH-GATE LG-2 |
| AR-AC-13 | DELETE non-202 → delete_error; stays signed in, data intact | COVERED | deleteFlowLogic.test.ts (DELETE error paths) |
| AR-AC-14 | DELETE network throw → delete_error | COVERED | deleteFlowLogic.test.ts |
| AR-AC-15 | DELETE 202 → performLogout (tokens + health stores cleared) → navigate to S1 | COVERED + MANUAL | deleteFlowLogic.test.ts (Invariant 1); flow 23 DEVICE-ONLY LG-8 |
| AR-AC-16 | Cancel/dismiss delete sheet → account unchanged, floor reset | COVERED | accountRightsController.test.ts (delete cancel paths); flow 24 |
| AR-AC-17 | Retry after ambiguous timeout: first DELETE non-202 → delete_error; second invocation (Retry) → delete_success + logout exactly once on 202 | COVERED | deleteFlowLogic.test.ts — "AR-AC-17 — composed retry after ambiguous timeout" describe block |
| AR-AC-18 | performLogout is called ONLY after HTTP 202 (never on tap, cancel, or non-202) | COVERED | deleteFlowLogic.test.ts (Invariant 1 describe block, all paths) |
| AR-AC-19 | Export nudge visible on delete sheet; tapping nudge opens export (prompt-not-block) | E2E | flow 23 (assertVisible delete-sheet-nudge); accountRightsController.test.ts |
| AR-AC-20 | Nudge does NOT gate the confirm button (user may skip export and delete) | E2E | flow 23 step 7 comment; accountRightsController.test.ts |
| AR-AC-21 | Disclosure section visible (slot rendered; no hardcoded retention number) | E2E | flow 23 (assertVisible delete-sheet-disclosure) |

---

## Step-up / C-2 degrade — AR-AC-26..28

| ID | Criterion | Coverage | Evidence |
|----|-----------|----------|----------|
| AR-AC-26 | C-2 degrade telemetry contains ONLY errorClass/platform/throwSite (no PII, no health data) | COVERED | deleteFlowLogic.test.ts (PII checks in probe + auth double-throw tests) |
| AR-AC-27 | Non-success biometric (cancel, lockout, fallback) → auth_cancelled; NEVER degrades to floor | COVERED | deleteFlowLogic.test.ts (Invariant 3; AR-AC-27 describe block; rule 5) |
| AR-AC-28 | Type-to-confirm floor is case-insensitive, trims surrounding whitespace | COVERED | confirmWordMatch.test.ts |

---

## Summary

| Status | Count |
|--------|-------|
| COVERED (unit / integration) | 20 |
| E2E (Maestro flow, Simulator-runnable) | 5 |
| MANUAL (device-only launch-gate) | 2 |
| GAP | 0 |

**Total automated tests (src/accountRights/ suites): 184**
(deleteFlowLogic: 64, exportOrchestration: 18, accountRightsController: varies, accountApiClient: varies, accountExportFileService: varies, confirmWordMatch: varies, deviceAuthAdapter: varies)

---

## Changelog

| Date | Change |
|------|--------|
| 2026-07-05 | Initial document created. AR-AC-17 COVERED by new test in deleteFlowLogic.test.ts. Minor-2: exportOrchestration nav-away test renamed to accurately describe request_aborted code→phase mapping. Flow 23 login parameterised with ${DISPOSABLE_EMAIL}/${DISPOSABLE_PASSWORD} env vars (Important-1). |
