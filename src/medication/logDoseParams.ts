/**
 * logDoseParams — pure helper for the "log a dose" affordance.
 *
 * Converts a MedicationPlan id into the Capture route-param shape so that
 * MedicationPlanListScreen (and any future affordance) can navigate to Capture
 * without coupling to the internal RootStackParamList['Capture'] shape.
 *
 * Security:
 *   planId is a UUID (opaque identifier) — not a drug name, dose, or health
 *   value. It is safe to pass in route params (PDPA SD-9).
 *   NEVER pass plan.name, plan.dose, or plan.scheduleRule in route params.
 */

/**
 * Builds the minimal Capture route params needed to open Capture in
 * medication-family mode pre-linked to a specific plan.
 *
 * The returned object is forwarded verbatim to
 * `navigation.navigate('Capture', buildLogDoseParams(plan.id))`.
 *
 * CaptureScreen interprets:
 *   medicationPlanId present → type pre-set to 'medication', plan resolved
 *   verbatim (name/dose from store), status defaults to 'taken' (INV-M1).
 *
 * @param planId — UUIDv4 id of the MedicationPlan to log against.
 * @returns `{ medicationPlanId: planId }` — single-key shape.
 */
export function buildLogDoseParams(planId: string): { medicationPlanId: string } {
  return { medicationPlanId: planId };
}
