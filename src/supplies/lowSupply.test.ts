import { isLow, evaluateLowSupply, SupplyState } from './lowSupply';

const item = (over: Partial<SupplyState>): SupplyState => ({
  onHandQty: 10,
  lowThreshold: 5,
  lowNotifiedAtVersion: null,
  version: 1,
  ...over,
});

describe('isLow', () => {
  it('is low at or below threshold', () => {
    expect(isLow(item({ onHandQty: 5, lowThreshold: 5 }))).toBe(true);
    expect(isLow(item({ onHandQty: 3, lowThreshold: 5 }))).toBe(true);
  });
  it('is not low above threshold', () => {
    expect(isLow(item({ onHandQty: 6, lowThreshold: 5 }))).toBe(false);
  });
  it('is never low with no threshold', () => {
    expect(isLow(item({ onHandQty: 0, lowThreshold: null }))).toBe(false);
  });
});

describe('evaluateLowSupply — edge-trigger + de-nag', () => {
  it('fires once on the not-low -> low crossing and sets the marker', () => {
    const d = evaluateLowSupply(item({ onHandQty: 4, lowThreshold: 5, lowNotifiedAtVersion: null, version: 7 }));
    expect(d.shouldAlert).toBe(true);
    expect(d.nextMarker).toBe(7); // non-null marker recorded
  });

  it('does NOT re-nag while still low once the marker is set', () => {
    const d = evaluateLowSupply(item({ onHandQty: 3, lowThreshold: 5, lowNotifiedAtVersion: 7 }));
    expect(d.shouldAlert).toBe(false);
    expect(d.nextMarker).toBe(7); // unchanged
  });

  it('cross-device: device B pulls an already-notified low item and stays silent', () => {
    // device A set the marker; device B sees low && marker non-null
    const d = evaluateLowSupply(item({ onHandQty: 2, lowThreshold: 5, lowNotifiedAtVersion: 4, version: 9 }));
    expect(d.shouldAlert).toBe(false);
  });

  it('fires once for an item created already below threshold', () => {
    const d = evaluateLowSupply(item({ onHandQty: 0, lowThreshold: 5, lowNotifiedAtVersion: null }));
    expect(d.shouldAlert).toBe(true);
  });

  it('fires when the threshold is raised above current stock', () => {
    const d = evaluateLowSupply(item({ onHandQty: 4, lowThreshold: 5, lowNotifiedAtVersion: null }));
    expect(d.shouldAlert).toBe(true);
  });

  it('clears the marker on restock above threshold (no alert)', () => {
    const d = evaluateLowSupply(item({ onHandQty: 8, lowThreshold: 5, lowNotifiedAtVersion: 7 }));
    expect(d.shouldAlert).toBe(false);
    expect(d.nextMarker).toBeNull();
  });

  it('clears the marker when the threshold is removed', () => {
    const d = evaluateLowSupply(item({ onHandQty: 0, lowThreshold: null, lowNotifiedAtVersion: 7 }));
    expect(d.shouldAlert).toBe(false);
    expect(d.nextMarker).toBeNull();
  });

  it('re-fires a fresh alert after clearing then dropping low again', () => {
    // after a clear, marker is null; a new drop crosses again
    const cleared = evaluateLowSupply(item({ onHandQty: 9, lowThreshold: 5, lowNotifiedAtVersion: 7 }));
    expect(cleared.nextMarker).toBeNull();
    const dropAgain = evaluateLowSupply(item({ onHandQty: 4, lowThreshold: 5, lowNotifiedAtVersion: cleared.nextMarker, version: 12 }));
    expect(dropAgain.shouldAlert).toBe(true);
    expect(dropAgain.nextMarker).toBe(12);
  });
});
