/**
 * feedingLog.integration.test.ts — REAL integration test for the feeding-log
 * surface wired path.
 *
 * These tests prove the FULL WIRED PATH from the FeedingLogScreen UI handler
 * through to the FeedingSession store and formula stock decrement engine.
 * They use REAL module instances (no mocks for stores or engines).
 *
 * DI strategy: FeedingLogScreen accepts optional DI props (_feedingSessionStore,
 * _supplyStore, _consumptionMappingStore, _markerStore) that default to the
 * module singletons in production. The tests inject fresh real instances so
 * each test runs in isolation.
 *
 * "Full wired path" means:
 *   1. The REAL FeedingLogScreen component function is called.
 *   2. The REAL `onSubmitFormulaFeed` handler (extracted from the rendered
 *      FormulaFeedSection element) is invoked — this is production code, not a
 *      mock. It calls the REAL feedingSessionStore and commitFormulaFeedDecrement.
 *   3. The REAL store state changes are asserted.
 *
 * FAIL-ON-REVERT: removing commitFormulaFeedDecrement from the handler makes
 * the supply-decrement assertions RED. Removing feedingSessionStore.commitLocalFormula
 * makes the session-count assertions RED. Removing the consent gate makes the
 * consent-blocked assertions RED.
 *
 * Security: synthetic IDs only — no real health values in fixtures (SD-5 / K-8).
 */

// ─── Module mocks (hoisted) ──────────────────────────────────────────────────

jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: jest.fn((init: unknown) => [init, jest.fn()]),
    useRef: jest.fn((init: unknown) => ({ current: init })),
    useCallback: jest.fn((fn: unknown) => fn),
    useMemo: jest.fn((fn: () => unknown) => fn()),
    useEffect: jest.fn(),
  };
});

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
  SafeAreaView: 'SafeAreaView',
  ScrollView: 'ScrollView',
  Platform: { OS: 'ios' },
}));

jest.mock('../i18n/LanguageContext', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'th' }),
}));

// consentStore is injected at runtime via props._consentStoreOverride (no module mock needed)
// BUT FormulaFeedSection reads from the module singleton. We mock it to return granted by default.
jest.mock('../consent/consentStore', () => ({
  consentStore: { isGranted: jest.fn(() => true), reset: jest.fn() },
}));

jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-session-uuid') }));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import React from 'react';
import type { FeedingLogScreenProps } from './FeedingLogScreen';
import { FeedingLogScreen } from './FeedingLogScreen';
import { FormulaFeedSection } from './FormulaFeedSection';
import { createFeedingSessionStore } from './feedingSessionStore';
import { createSyncStore } from '../sync/syncStore';
import { createConsumptionMappingStore } from './consumptionMappingStore';
import { createStockDecrementMarkerStore } from './stockDecrementMarkerStore';
import { consentStore } from '../consent/consentStore';
import type { SupplyItemRecord, ConsumptionMappingRecord } from '../sync/syncTypes';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Walk element tree and return all elements matching predicate. */
function findAll(node: unknown, pred: (el: React.ReactElement) => boolean): React.ReactElement[] {
  const acc: React.ReactElement[] = [];
  function walk(n: unknown): void {
    if (n == null || typeof n === 'string' || typeof n === 'number' || typeof n === 'boolean') return;
    if (Array.isArray(n)) { (n as unknown[]).forEach(walk); return; }
    if (!React.isValidElement(n)) return;
    const el = n as React.ReactElement;
    if (pred(el)) acc.push(el);
    walk((el.props as { children?: unknown }).children);
  }
  walk(node);
  return acc;
}

function makeSupplyItem(overrides: Partial<SupplyItemRecord> = {}): SupplyItemRecord {
  const now = '2026-07-11T00:00:00Z';
  return {
    id: 'item-formula-1',
    name: 'นมผง',
    category: 'feeding',
    onHandQty: 3,
    usesPerContainer: 26,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeMapping(overrides: Partial<ConsumptionMappingRecord> = {}): ConsumptionMappingRecord {
  const now = '2026-07-11T00:00:00Z';
  return {
    id: 'map-formula-1',
    activityType: 'feeding_formula',
    supplyItemId: 'item-formula-1',
    defaultQty: 4,
    enabled: true,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const mockTokenStorage = {
  load: jest.fn(() => Promise.resolve(null)),
  save: jest.fn(),
  clear: jest.fn(),
};

/** Render FeedingLogScreen with real DI'd stores. Returns the element tree. */
function renderFeedingLogScreen(
  storeOverrides: Partial<FeedingLogScreenProps> = {},
): React.ReactElement {
  return (FeedingLogScreen as unknown as (p: FeedingLogScreenProps) => React.ReactElement)({
    tokenStorage: mockTokenStorage as never,
    apiBaseUrl: 'https://test.example.com',
    onBack: jest.fn(),
    ...storeOverrides,
  });
}

// ─── Section A: Formula path — full wired path ────────────────────────────────
//
// This is the crux test. It renders FeedingLogScreen with REAL injected stores,
// extracts the REAL onSubmitFormulaFeed handler from the rendered FormulaFeedSection
// element, calls it, and asserts BOTH the FeedingSession persistence AND the
// supply decrement.
//
// FAIL-ON-REVERT:
//   Remove commitFormulaFeedDecrement call → supply assertion RED
//   Remove feedingSessionStore.commitLocalFormula → session count RED
//   Remove consent gate → consent-blocked test RED

describe('[FeedingLog Integration] A — formula path: FeedingSession + supply decrement', () => {
  let realFeedingSessionStore: ReturnType<typeof createFeedingSessionStore>;
  let realSupplyStore: ReturnType<typeof createSyncStore>;
  let realMappingStore: ReturnType<typeof createConsumptionMappingStore>;
  let realMarkerStore: ReturnType<typeof createStockDecrementMarkerStore>;

  beforeEach(() => {
    jest.clearAllMocks();
    realFeedingSessionStore = createFeedingSessionStore();
    realSupplyStore = createSyncStore();
    realMappingStore = createConsumptionMappingStore();
    realMarkerStore = createStockDecrementMarkerStore();

    // Seed supply store with a formula item (20 scoops remaining in open tin)
    realSupplyStore.upsertSupplyItem(makeSupplyItem());
    realSupplyStore.applyDecrementDraw('item-formula-1', {
      onHandQty: 3,
      usesRemaining: 20,
      usesPerContainer: 26,
    });

    // Seed mapping: feeding_formula → item-formula-1
    realMappingStore.upsert(makeMapping());

    // Consent: both general_health + infant_feeding granted
    (consentStore.isGranted as jest.Mock).mockReturnValue(true);
  });

  it('submitting formula via onSubmitFormulaFeed persists FeedingSession AND decrements supply', () => {
    const tree = renderFeedingLogScreen({
      _feedingSessionStore: realFeedingSessionStore,
      _supplyStore: realSupplyStore,
      _consumptionMappingStore: realMappingStore,
      _markerStore: realMarkerStore,
    });

    // Find FormulaFeedSection element in the rendered tree
    const formulaSections = findAll(tree, (el) => el.type === FormulaFeedSection);
    expect(formulaSections.length).toBeGreaterThan(0);

    const formulaSection = formulaSections[0]!;
    const props = formulaSection.props as {
      onSubmitFormulaFeed?: (amount: number | null) => void;
    };

    // The handler must be wired (FAIL-ON-REVERT: removing the prop makes this RED)
    expect(typeof props.onSubmitFormulaFeed).toBe('function');

    // Invoke the REAL production handler with 4 scoops
    props.onSubmitFormulaFeed!(4);

    // Assert 1: FeedingSession persisted
    expect(realFeedingSessionStore.getCount()).toBe(1);
    const session = realFeedingSessionStore.getAll()[0]!;
    expect(session.kind).toBe('formula');
    // NEVER assert amountSubUnits value (K-8 / SD-5) — only check it exists
    expect(typeof session.amountSubUnits).toBe('number');

    // Assert 2: supply decremented (20 - 4 = 16 uses remaining)
    const item = realSupplyStore.getSupplyItem('item-formula-1')!;
    expect(item.usesRemainingInOpenContainer).toBe(16);
    expect(item.onHandQty).toBe(3); // no container transition
  });

  it('null amount falls back to mapping.defaultQty (D-2) and decrements', () => {
    const tree = renderFeedingLogScreen({
      _feedingSessionStore: realFeedingSessionStore,
      _supplyStore: realSupplyStore,
      _consumptionMappingStore: realMappingStore,
      _markerStore: realMarkerStore,
    });

    const props = (findAll(tree, (el) => el.type === FormulaFeedSection)[0]!.props) as {
      onSubmitFormulaFeed?: (amount: number | null) => void;
    };

    // null amount → uses mapping.defaultQty = 4 → 20 - 4 = 16
    props.onSubmitFormulaFeed!(null);

    expect(realFeedingSessionStore.getCount()).toBe(1);
    expect(realSupplyStore.getSupplyItem('item-formula-1')!.usesRemainingInOpenContainer).toBe(16);
  });

  it('idempotency: second submit with same sessionId returns already_seen (no double-decrement)', () => {
    // uuid is mocked to always return 'test-session-uuid' → same id on both calls
    const tree = renderFeedingLogScreen({
      _feedingSessionStore: realFeedingSessionStore,
      _supplyStore: realSupplyStore,
      _consumptionMappingStore: realMappingStore,
      _markerStore: realMarkerStore,
    });

    const props = (findAll(tree, (el) => el.type === FormulaFeedSection)[0]!.props) as {
      onSubmitFormulaFeed?: (amount: number | null) => void;
    };

    props.onSubmitFormulaFeed!(4);  // first call: applied (20 → 16)
    props.onSubmitFormulaFeed!(4);  // second call: already_seen (no second draw)

    // FeedingSession store: idempotent create — still 1 record (same id)
    expect(realFeedingSessionStore.getCount()).toBe(1);
    // Supply: only ONE draw applied (16 not 12)
    expect(realSupplyStore.getSupplyItem('item-formula-1')!.usesRemainingInOpenContainer).toBe(16);
  });

  it('container transition: onHandQty decrements and push enqueued', () => {
    // 2 scoops remaining → draw of 4 rolls over into next tin
    realSupplyStore.applyDecrementDraw('item-formula-1', {
      onHandQty: 3,
      usesRemaining: 2,
      usesPerContainer: 26,
    });

    const tree = renderFeedingLogScreen({
      _feedingSessionStore: realFeedingSessionStore,
      _supplyStore: realSupplyStore,
      _consumptionMappingStore: realMappingStore,
      _markerStore: realMarkerStore,
    });

    const props = (findAll(tree, (el) => el.type === FormulaFeedSection)[0]!.props) as {
      onSubmitFormulaFeed?: (amount: number | null) => void;
    };

    props.onSubmitFormulaFeed!(4);

    const item = realSupplyStore.getSupplyItem('item-formula-1')!;
    // Rolled into next tin: onHandQty 3 → 2
    expect(item.onHandQty).toBe(2);
    // 2 drawn from old, 2 drawn from new (26 - 2 = 24)
    expect(item.usesRemainingInOpenContainer).toBe(24);

    // Container transition → push enqueued (INV-ASD-8)
    const changeset = realSupplyStore.drainQueue();
    expect(changeset.supplyItems!.updated.length).toBe(1);
    expect(changeset.supplyItems!.updated[0]!.id).toBe('item-formula-1');

    // INV-ASD-8: pushed record must NOT have usesRemainingInOpenContainer
    expect(
      Object.prototype.hasOwnProperty.call(changeset.supplyItems!.updated[0]!, 'usesRemainingInOpenContainer')
    ).toBe(false);
  });
});

// ─── Section B: Consent gate — dual-gate for formula ─────────────────────────

describe('[FeedingLog Integration] B — consent gate: SD-10 dual-gate', () => {
  let realFeedingSessionStore: ReturnType<typeof createFeedingSessionStore>;
  let realSupplyStore: ReturnType<typeof createSyncStore>;
  let realMappingStore: ReturnType<typeof createConsumptionMappingStore>;
  let realMarkerStore: ReturnType<typeof createStockDecrementMarkerStore>;

  beforeEach(() => {
    jest.clearAllMocks();
    realFeedingSessionStore = createFeedingSessionStore();
    realSupplyStore = createSyncStore();
    realMappingStore = createConsumptionMappingStore();
    realMarkerStore = createStockDecrementMarkerStore();

    realSupplyStore.upsertSupplyItem(makeSupplyItem());
    realSupplyStore.applyDecrementDraw('item-formula-1', {
      onHandQty: 3,
      usesRemaining: 20,
      usesPerContainer: 26,
    });
    realMappingStore.upsert(makeMapping());
  });

  it('consent_blocked: missing infant_feeding → formula submit does NOT decrement', () => {
    // general_health=true, infant_feeding=false
    (consentStore.isGranted as jest.Mock).mockImplementation(
      (type: string) => type === 'general_health',
    );

    const tree = renderFeedingLogScreen({
      _feedingSessionStore: realFeedingSessionStore,
      _supplyStore: realSupplyStore,
      _consumptionMappingStore: realMappingStore,
      _markerStore: realMarkerStore,
    });

    const props = (findAll(tree, (el) => el.type === FormulaFeedSection)[0]!.props) as {
      onSubmitFormulaFeed?: (amount: number | null) => void;
    };

    // Call the handler directly — even if UI were to invoke it, the write path
    // must gate on consent (belt-and-suspenders SD-10)
    props.onSubmitFormulaFeed!(4);

    // No FeedingSession stored (gate at write path)
    expect(realFeedingSessionStore.getCount()).toBe(0);
    // Supply unchanged
    expect(realSupplyStore.getSupplyItem('item-formula-1')!.usesRemainingInOpenContainer).toBe(20);
  });

  it('consent_blocked: missing general_health → formula submit does NOT decrement', () => {
    // general_health=false, infant_feeding=true
    (consentStore.isGranted as jest.Mock).mockImplementation(
      (type: string) => type === 'infant_feeding',
    );

    const tree = renderFeedingLogScreen({
      _feedingSessionStore: realFeedingSessionStore,
      _supplyStore: realSupplyStore,
      _consumptionMappingStore: realMappingStore,
      _markerStore: realMarkerStore,
    });

    const props = (findAll(tree, (el) => el.type === FormulaFeedSection)[0]!.props) as {
      onSubmitFormulaFeed?: (amount: number | null) => void;
    };

    props.onSubmitFormulaFeed!(4);

    expect(realFeedingSessionStore.getCount()).toBe(0);
    expect(realSupplyStore.getSupplyItem('item-formula-1')!.usesRemainingInOpenContainer).toBe(20);
  });
});

// ─── Section C: Breastfeed / pump paths — no decrement ───────────────────────

describe('[FeedingLog Integration] C — breastfeed/pump: logs session, no decrement', () => {
  let realFeedingSessionStore: ReturnType<typeof createFeedingSessionStore>;
  let realSupplyStore: ReturnType<typeof createSyncStore>;
  let realMappingStore: ReturnType<typeof createConsumptionMappingStore>;
  let realMarkerStore: ReturnType<typeof createStockDecrementMarkerStore>;

  beforeEach(() => {
    jest.clearAllMocks();
    realFeedingSessionStore = createFeedingSessionStore();
    realSupplyStore = createSyncStore();
    realMappingStore = createConsumptionMappingStore();
    realMarkerStore = createStockDecrementMarkerStore();

    realSupplyStore.upsertSupplyItem(makeSupplyItem());
    realSupplyStore.applyDecrementDraw('item-formula-1', {
      onHandQty: 3,
      usesRemaining: 20,
      usesPerContainer: 26,
    });
    realMappingStore.upsert(makeMapping());

    (consentStore.isGranted as jest.Mock).mockReturnValue(true);
  });

  it('breastfeed chip tapped → save persists session with kind=breastfeed, no supply change', () => {
    const tree = renderFeedingLogScreen({
      _feedingSessionStore: realFeedingSessionStore,
      _supplyStore: realSupplyStore,
      _consumptionMappingStore: realMappingStore,
      _markerStore: realMarkerStore,
    });

    // Find the breastfeed save handler (testID='feeding-log-breastfeed-save')
    const saveBtns = findAll(
      tree,
      (el) => (el.props as { testID?: string }).testID === 'feeding-log-save-btn',
    );
    expect(saveBtns.length).toBeGreaterThan(0);

    const saveBtn = saveBtns[0]!;
    (saveBtn.props as { onPress: () => void }).onPress();

    // FeedingSession persisted with kind=breastfeed (initial kind)
    expect(realFeedingSessionStore.getCount()).toBe(1);
    const session = realFeedingSessionStore.getAll()[0]!;
    expect(session.kind).toBe('breastfeed');

    // Supply NOT decremented (no formula decrement for breastfeed)
    expect(realSupplyStore.getSupplyItem('item-formula-1')!.usesRemainingInOpenContainer).toBe(20);
    expect(realSupplyStore.getPendingCount()).toBe(0);
  });

  it('general_health missing → breastfeed save does NOT persist session', () => {
    (consentStore.isGranted as jest.Mock).mockReturnValue(false);

    const tree = renderFeedingLogScreen({
      _feedingSessionStore: realFeedingSessionStore,
      _supplyStore: realSupplyStore,
      _consumptionMappingStore: realMappingStore,
      _markerStore: realMarkerStore,
    });

    const saveBtns = findAll(
      tree,
      (el) => (el.props as { testID?: string }).testID === 'feeding-log-save-btn',
    );

    if (saveBtns.length > 0) {
      (saveBtns[0]!.props as { onPress: () => void }).onPress();
    }

    // Gated: no session persisted
    expect(realFeedingSessionStore.getCount()).toBe(0);
  });
});

// ─── Section D: FW-1 compliance on the formula chip label ────────────────────

describe('[FeedingLog Integration] D — FW-1: no brand/promo copy', () => {
  beforeEach(() => {
    (consentStore.isGranted as jest.Mock).mockReturnValue(true);
  });

  it('FormulaFeedSection chip label uses formulaFeed.chip i18n key only (FW-1)', () => {
    const { scanForFW1Violations } = jest.requireActual<typeof import('./fw1Scanner')>('./fw1Scanner');

    const tree = renderFeedingLogScreen({});

    // Collect all text from the element tree
    const textContent: string[] = [];
    function collectText(node: unknown): void {
      if (node == null || typeof node === 'boolean') return;
      if (typeof node === 'string') { textContent.push(node); return; }
      if (typeof node === 'number') { textContent.push(String(node)); return; }
      if (Array.isArray(node)) { (node as unknown[]).forEach(collectText); return; }
      if (!React.isValidElement(node)) return;
      const el = node as React.ReactElement;
      collectText((el.props as { children?: unknown }).children);
    }
    collectText(tree);

    // No FW-1 violations in any rendered text
    const allText = textContent.join(' ');
    const violations = scanForFW1Violations(allText);
    expect(violations).toHaveLength(0);
  });
});

// ─── Section E: INV-ASD-8 — mobile-local field absent on stored session ───────

describe('[FeedingLog Integration] E — ASD-8-2: stored session has no mobile-local supply field', () => {
  it('FeedingSessionRecord stored by commitLocalFormula has no usesRemainingInOpenContainer', () => {
    (consentStore.isGranted as jest.Mock).mockReturnValue(true);

    const realFeedingSessionStore = createFeedingSessionStore();
    const realSupplyStore = createSyncStore();
    const realMappingStore = createConsumptionMappingStore();
    const realMarkerStore = createStockDecrementMarkerStore();

    realSupplyStore.upsertSupplyItem(makeSupplyItem());
    realSupplyStore.applyDecrementDraw('item-formula-1', { onHandQty: 3, usesRemaining: 20, usesPerContainer: 26 });
    realMappingStore.upsert(makeMapping());

    const tree = renderFeedingLogScreen({
      _feedingSessionStore: realFeedingSessionStore,
      _supplyStore: realSupplyStore,
      _consumptionMappingStore: realMappingStore,
      _markerStore: realMarkerStore,
    });

    const props = (findAll(tree, (el) => el.type === FormulaFeedSection)[0]!.props) as {
      onSubmitFormulaFeed?: (amount: number | null) => void;
    };
    props.onSubmitFormulaFeed!(4);

    const session = realFeedingSessionStore.getAll()[0]! as unknown as Record<string, unknown>;
    // FeedingSessionRecord must NOT carry any supply-side mobile-local field (INV-ASD-8)
    expect(Object.prototype.hasOwnProperty.call(session, 'usesRemainingInOpenContainer')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(session, 'onHandQty')).toBe(false);
  });
});

// ─── Section F: In-flight guard — prevents double-tap double-decrement ────────
//
// FAIL-ON-REVERT:
//   Remove `isSubmittingRef.current = true` from handleFormulaSubmit →
//   both taps go through → getCount() === 2, usesRemainingInOpenContainer === 12
//   → assertions go RED.
//
// Note: uuid is overridden per-test to return unique values so that E-10
// idempotency does NOT silently deduplicate the second call. The only thing
// preventing the second call must be the isSubmitting guard.

describe('[FeedingLog Integration] F — in-flight guard: double-tap fires ONE session + ONE decrement', () => {
  let realFeedingSessionStore: ReturnType<typeof createFeedingSessionStore>;
  let realSupplyStore: ReturnType<typeof createSyncStore>;
  let realMappingStore: ReturnType<typeof createConsumptionMappingStore>;
  let realMarkerStore: ReturnType<typeof createStockDecrementMarkerStore>;

  beforeEach(() => {
    jest.clearAllMocks();
    realFeedingSessionStore = createFeedingSessionStore();
    realSupplyStore = createSyncStore();
    realMappingStore = createConsumptionMappingStore();
    realMarkerStore = createStockDecrementMarkerStore();

    realSupplyStore.upsertSupplyItem(makeSupplyItem());
    realSupplyStore.applyDecrementDraw('item-formula-1', {
      onHandQty: 3,
      usesRemaining: 20,
      usesPerContainer: 26,
    });
    realMappingStore.upsert(makeMapping());

    (consentStore.isGranted as jest.Mock).mockReturnValue(true);
  });

  it('rapid double-tap on formula submit: only ONE FeedingSession persisted + ONE decrement applied', () => {
    // Give each uuid() call a unique value — proves the guard (not E-10 same-id
    // idempotency) is blocking the second call.
    const uuidModule = require('uuid') as { v4: jest.Mock };
    let uuidSeq = 0;
    uuidModule.v4.mockImplementation(() => `guard-session-${++uuidSeq}`);

    const tree = renderFeedingLogScreen({
      _feedingSessionStore: realFeedingSessionStore,
      _supplyStore: realSupplyStore,
      _consumptionMappingStore: realMappingStore,
      _markerStore: realMarkerStore,
    });

    const props = (findAll(tree, (el) => el.type === FormulaFeedSection)[0]!.props) as {
      onSubmitFormulaFeed?: (amount: number | null) => void;
    };

    expect(typeof props.onSubmitFormulaFeed).toBe('function');

    // Two synchronous taps — second must be blocked by isSubmitting guard.
    props.onSubmitFormulaFeed!(4);
    props.onSubmitFormulaFeed!(4);

    // Only ONE FeedingSession record (guard blocked the second call before store write)
    expect(realFeedingSessionStore.getCount()).toBe(1);

    // Only ONE decrement applied: 20 - 4 = 16 (not 12)
    expect(realSupplyStore.getSupplyItem('item-formula-1')!.usesRemainingInOpenContainer).toBe(16);

    // Restore uuid mock for subsequent tests
    uuidModule.v4.mockReturnValue('test-session-uuid');
  });
});
