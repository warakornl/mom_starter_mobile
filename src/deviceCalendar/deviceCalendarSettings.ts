/**
 * deviceCalendarSettings — feature on/off + privacyLevel + resolved calendarId.
 *
 * Durable, device-local. Injectable storage for tests.
 * Trace: architecture §1.1 (deviceCalendarSettings), §5.3 (target calendar resolution).
 * SECURITY: NEVER store health data here.
 */

import type { PrivacyLevel } from './eventPayloadBuilder';

export interface DeviceCalendarSettingsData {
  featureEnabled:    boolean;
  privacyLevel:      PrivacyLevel;
  resolvedCalendarId: string | null;
  /** Flag for permission-revoked / re-mask failure attention states (CAL-SCR-30). */
  needsAttention:    boolean;
  /** Reason for needs-attention state. */
  attentionReason:  'permission_denied' | 'permission_revoked' | 'remask_failed' | null;
}

export interface SettingsStorage {
  save(json: string): Promise<void>;
  load(): Promise<string | null>;
}

const DEFAULTS: DeviceCalendarSettingsData = {
  featureEnabled:    false,
  privacyLevel:      'generic',   // CS-TITLE-1: Generic is the default (AC-1.3)
  resolvedCalendarId: null,
  needsAttention:    false,
  attentionReason:  null,
};

export function createDeviceCalendarSettings(storage?: SettingsStorage) {
  let _data: DeviceCalendarSettingsData = { ...DEFAULTS };

  function save(): void {
    if (!storage) return;
    void storage.save(JSON.stringify(_data));
  }

  return {
    get(): DeviceCalendarSettingsData {
      return { ..._data };
    },

    setFeatureEnabled(enabled: boolean): void {
      _data = { ..._data, featureEnabled: enabled };
      save();
    },

    setPrivacyLevel(level: PrivacyLevel): void {
      _data = { ..._data, privacyLevel: level };
      save();
    },

    setResolvedCalendarId(id: string | null): void {
      _data = { ..._data, resolvedCalendarId: id };
      save();
    },

    setNeedsAttention(reason: DeviceCalendarSettingsData['attentionReason']): void {
      _data = { ..._data, needsAttention: reason !== null, attentionReason: reason };
      save();
    },

    clearAttention(): void {
      _data = { ..._data, needsAttention: false, attentionReason: null };
      save();
    },

    async persist(): Promise<void> {
      if (!storage) return;
      await storage.save(JSON.stringify(_data));
    },

    async loadFromStorage(): Promise<void> {
      if (!storage) return;
      const json = await storage.load();
      if (!json) return;
      try {
        const parsed = JSON.parse(json) as Partial<DeviceCalendarSettingsData>;
        _data = { ...DEFAULTS, ...parsed };
      } catch {
        _data = { ...DEFAULTS };
      }
    },

    reset(): void {
      _data = { ...DEFAULTS };
      save();
    },
  };
}

export type DeviceCalendarSettings = ReturnType<typeof createDeviceCalendarSettings>;
