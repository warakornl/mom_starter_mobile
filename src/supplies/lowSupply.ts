/**
 * Low-supply edge-trigger + cross-device de-nag (device-side, NON-health).
 *
 * The alert fires ONCE when an item crosses not-low -> low. While it stays low,
 * a synced marker `lowNotifiedAtVersion` suppresses re-nagging (including on a
 * second device that pulls the already-notified item). When the item returns to
 * not-low the marker clears, so a later drop fires a FRESH alert.
 *
 * This logic reads ONLY supply fields — never any health value (the §7
 * no-threshold-on-health rule applies to health data; supplies are non-health).
 */
export interface SupplyState {
  onHandQty: number;
  /** null = no low threshold set for this item */
  lowThreshold: number | null;
  /** de-nag marker: null = no outstanding low-notification; non-null = this low episode already alerted */
  lowNotifiedAtVersion: number | null;
  /** the item's current sync version (used as the marker value when alerting) */
  version: number;
}

/** An item is "low" when it has a threshold and is at or below it. */
export function isLow(s: SupplyState): boolean {
  return s.lowThreshold !== null && s.onHandQty <= s.lowThreshold;
}

export interface LowSupplyDecision {
  /** raise the (lock-screen-safe) low-supply notification now */
  shouldAlert: boolean;
  /** the marker to persist on the item (null clears it) */
  nextMarker: number | null;
}

/**
 * Pure evaluation run by the device whenever an item's quantity/threshold
 * changes or a synced update arrives. Returns whether to alert and the marker
 * to store. The stored marker value itself is never read by logic (only its
 * null vs non-null presence matters in MVP).
 */
export function evaluateLowSupply(s: SupplyState): LowSupplyDecision {
  if (isLow(s)) {
    if (s.lowNotifiedAtVersion === null) {
      // crossing into low (or created already-low, or threshold raised above stock)
      return { shouldAlert: true, nextMarker: s.version };
    }
    // already notified for this low episode (same device or pulled from another)
    return { shouldAlert: false, nextMarker: s.lowNotifiedAtVersion };
  }
  // not low: clear the marker so a future drop re-fires a fresh alert
  return { shouldAlert: false, nextMarker: null };
}
