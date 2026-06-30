/**
 * kickCountDraftStore tests — TDD (failing first).
 *
 * The draft store uses expo-secure-store for encrypted-at-rest storage (K-8).
 * expo-secure-store is mocked here because it is a native module.
 *
 * Covers:
 *  - saveDraft() persists encrypted draft
 *  - loadDraft() retrieves and parses draft
 *  - clearDraft() removes draft (crypto-shred semantics)
 *  - Only 1 draft at a time (1 key per device)
 *  - null when no draft exists
 */

// Mock expo-secure-store (native module)
const secureStoreData: Record<string, string> = {};
const mockSetItemAsync = jest.fn((key: string, value: string) => {
  secureStoreData[key] = value;
  return Promise.resolve();
});
const mockGetItemAsync = jest.fn((key: string) => {
  return Promise.resolve(secureStoreData[key] ?? null);
});
const mockDeleteItemAsync = jest.fn((key: string) => {
  delete secureStoreData[key];
  return Promise.resolve();
});

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  setItemAsync: mockSetItemAsync,
  getItemAsync: mockGetItemAsync,
  deleteItemAsync: mockDeleteItemAsync,
}));

import { saveDraft, loadDraft, clearDraft } from './kickCountDraftStore';
import type { KickCountDraft } from './kickCountTypes';

function makeDraft(overrides: Partial<KickCountDraft> = {}): KickCountDraft {
  return {
    localDraftId: 'draft-uuid-0001',
    startedAt: '2026-06-30T09:15',
    movementCount: 7,
    targetCount: 10,
    gestationalWeekAtStart: 34,
    sessionStartMonotonicMs: 1000,
    note: null,
    ...overrides,
  };
}

describe('kickCountDraftStore (K-8 encrypted store)', () => {
  beforeEach(() => {
    // Clear all data between tests
    Object.keys(secureStoreData).forEach((k) => delete secureStoreData[k]);
    mockSetItemAsync.mockClear();
    mockGetItemAsync.mockClear();
    mockDeleteItemAsync.mockClear();
  });

  it('saveDraft() stores draft via expo-secure-store', async () => {
    const draft = makeDraft();
    await saveDraft(draft);
    // The value should be stored (encrypted by secure store)
    const raw = secureStoreData['kick_count_draft'];
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!);
    expect(parsed.localDraftId).toBe(draft.localDraftId);
    expect(parsed.movementCount).toBe(7);
  });

  it('loadDraft() returns the stored draft', async () => {
    const draft = makeDraft({ movementCount: 3, gestationalWeekAtStart: 32 });
    await saveDraft(draft);
    const loaded = await loadDraft();
    expect(loaded).not.toBeNull();
    expect(loaded!.localDraftId).toBe(draft.localDraftId);
    expect(loaded!.movementCount).toBe(3);
    expect(loaded!.gestationalWeekAtStart).toBe(32);
  });

  it('loadDraft() returns null when no draft exists', async () => {
    const loaded = await loadDraft();
    expect(loaded).toBeNull();
  });

  it('clearDraft() removes the draft (crypto-shred)', async () => {
    await saveDraft(makeDraft());
    await clearDraft();
    const loaded = await loadDraft();
    expect(loaded).toBeNull();
  });

  it('saveDraft() overwrites the existing draft (1 draft per device)', async () => {
    await saveDraft(makeDraft({ localDraftId: 'first-draft', movementCount: 2 }));
    await saveDraft(makeDraft({ localDraftId: 'second-draft', movementCount: 5 }));
    const loaded = await loadDraft();
    expect(loaded!.localDraftId).toBe('second-draft');
    expect(loaded!.movementCount).toBe(5);
  });

  it('draft includes note field', async () => {
    const draft = makeDraft({ note: 'ลูกดิ้นแรงหลังอาหารเช้า' });
    await saveDraft(draft);
    const loaded = await loadDraft();
    expect(loaded!.note).toBe('ลูกดิ้นแรงหลังอาหารเช้า');
  });

  // ── appsec-1.2: WHEN_UNLOCKED_THIS_DEVICE_ONLY (iCloud backup leak prevention) ──

  it('saveDraft() passes keychainAccessible=WHEN_UNLOCKED_THIS_DEVICE_ONLY (appsec-1.2)', async () => {
    await saveDraft(makeDraft());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callArgs = mockSetItemAsync.mock.calls[0] as any[];
    expect(callArgs[2]).toMatchObject({
      keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    });
  });

  it('loadDraft() passes keychainAccessible=WHEN_UNLOCKED_THIS_DEVICE_ONLY (appsec-1.2)', async () => {
    await loadDraft();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callArgs = mockGetItemAsync.mock.calls[0] as any[];
    expect(callArgs[1]).toMatchObject({
      keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    });
  });

  it('clearDraft() passes keychainAccessible=WHEN_UNLOCKED_THIS_DEVICE_ONLY (appsec-1.2)', async () => {
    await clearDraft();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callArgs = mockDeleteItemAsync.mock.calls[0] as any[];
    expect(callArgs[1]).toMatchObject({
      keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    });
  });
});
