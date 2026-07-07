/**
 * ProfileInfoEditScreen — edit mother first/last name + optional baby name.
 *
 * Lifecycle-agnostic: works for BOTH pregnant AND postpartum profiles.
 * Unlike ProfileEditScreen, which is pregnant-only (AC-2 gate on EDD editing).
 *
 * Entry: ProfileHubScreen > "แก้ไขชื่อ / ข้อมูลส่วนตัว" row.
 *   On mount: GETs a fresh full profile (name cipher fields absent from snapshot).
 *
 * Name fields spec:
 *   - motherFirstName, motherLastName, babyName — all optional (api-contract.md L681)
 *   - Wire format: Base64 ciphertext (MVP no-op: base64(utf8(name)))
 *   - Client trims + enforces ≤100 chars before encoding (api-contract mandate)
 *   - Empty field → sends null in PUT body (clears the server column to NULL)
 *   - PUT always carries edd from the loaded profile (no-op-PUT pin — api-contract L576)
 *
 * Security / PDPA:
 *   - SD-5 (BLOCKING): GET 401 and PUT 401 → call onSessionExpired (performLogout).
 *   - SD-9: NO name data in route params. Profile fetched fresh on mount.
 *   - PDPA identity PII: NEVER log decoded name values.
 *   - PDPA minimization (OQ-N-SEC2): full name visible ONLY inside this screen.
 *     ProfileHub summary shows first name only (ProfileSnapshot.motherFirstNameDecoded).
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { TokenStorage } from '../auth/tokenStorage';
import { useT } from '../i18n/LanguageContext';
import { createPregnancyClient } from './pregnancyApiClient';
import { localCivilToday } from './gestationalAge';
import {
  resolveInfoEditGetOutcome,
  resolveInfoEditPutOutcome,
  validateNameInput,
  buildFormStateFromProfile,
  buildInfoEditPutInput,
} from './profileInfoEditLogic';
import type { NameFormState } from './profileInfoEditLogic';
import type { PregnancyProfile } from './types';

// ─── Props ─────────────────────────────────────────────────────────────────────

export interface ProfileInfoEditScreenProps {
  /** Shared secure token storage (provides accessToken + refreshToken). */
  tokenStorage: TokenStorage;
  /** API base URL (e.g. from src/config.ts). */
  apiBaseUrl: string;
  /**
   * Called after a successful PUT 200/201. Caller should navigate.goBack().
   * Passes the updated profile for optional snapshot refresh.
   */
  onSaveComplete: (profile: PregnancyProfile) => void;
  /**
   * SD-5 (BLOCKING): Called on GET 401 or PUT 401 (no token or server-expired).
   * Caller MUST run the full performLogout teardown (clearTokens + ALL health stores)
   * then navigate.reset to Welcome. Reuse the exact runner from RootNavigator.
   */
  onSessionExpired: () => void;
}

// ─── Screen states ─────────────────────────────────────────────────────────────

type ScreenState =
  | { mode: 'loading' }
  | { mode: 'show-form'; profile: PregnancyProfile }
  | { mode: 'not-found' }
  | { mode: 'error'; message: string }
  | { mode: 'saving' }
  | { mode: 'saved' };

// ─── Component ─────────────────────────────────────────────────────────────────

export function ProfileInfoEditScreen({
  tokenStorage,
  apiBaseUrl,
  onSaveComplete,
  onSessionExpired,
}: ProfileInfoEditScreenProps): React.JSX.Element {
  const { t } = useT();

  // ── State ──────────────────────────────────────────────────────────────────
  const [screenState, setScreenState] = useState<ScreenState>({ mode: 'loading' });
  const [formState, setFormState] = useState<NameFormState>({
    motherFirstName: '',
    motherLastName: '',
    babyName: '',
  });

  // Validation errors per field (null = no error)
  const [errors, setErrors] = useState<{
    motherFirstName: string | null;
    motherLastName: string | null;
    babyName: string | null;
  }>({
    motherFirstName: null,
    motherLastName: null,
    babyName: null,
  });

  // Inline error shown below save button (conflict, generic)
  const [saveError, setSaveError] = useState<string | null>(null);

  // DEF-001 fix: carry a pending conflict message across the doEntryGet re-fetch.
  // Direct setSaveError(conflictMsg) in handleSave is cleared by doEntryGet's
  // synchronous setScreenState({ mode: 'loading' }) in the same React 18 batch
  // (last-write-wins = null). Instead, store the message here and apply it AFTER
  // the GET resolves to show-form (outside the batched synchronous prefix).
  const pendingErrorRef = useRef<string | null>(null);

  // ── Entry GET ──────────────────────────────────────────────────────────────
  const doEntryGet = useCallback(async () => {
    // Consume any pending conflict message now (before async work).
    // Applying it here (sync) would risk being batched with setScreenState({ mode:
    // 'loading' }) and cleared. Instead, carry it to the show-form case below.
    const pendingError = pendingErrorRef.current;
    pendingErrorRef.current = null;

    setScreenState({ mode: 'loading' });
    // NOTE: setSaveError(null) is intentionally removed from here.
    // Normal (no-conflict) entry: pendingError is null → setSaveError(null) runs in
    //   the show-form case below, preserving the original stale-error clearing behavior.
    // Conflict re-fetch: pendingError carries the message → applied in show-form below.

    const tokens = await tokenStorage.load();
    const accessToken = tokens?.accessToken;

    if (!accessToken) {
      // No token → treat as session expired (SD-5)
      onSessionExpired();
      return;
    }

    try {
      const client = createPregnancyClient(apiBaseUrl);
      const clientDate = localCivilToday();
      const result = await client.getProfile(accessToken, clientDate);
      const outcome = resolveInfoEditGetOutcome(result);

      switch (outcome.type) {
        case 'session-expired':
          onSessionExpired();
          return;

        case 'show-form':
          // Decode the name fields from wire format to display strings
          // NEVER log the decoded values (PDPA identity PII)
          setFormState(buildFormStateFromProfile(outcome.profile));
          setScreenState({ mode: 'show-form', profile: outcome.profile });
          // Apply pending conflict message (DEF-001 fix): if this re-fetch was
          // triggered by a 409 conflict, pendingError holds the conflict message
          // and is set here AFTER the GET await (outside the sync batch that
          // triggered loading). On normal/fresh entry, pendingError is null —
          // setSaveError(null) clears any stale generic error from a prior save.
          setSaveError(pendingError);
          return;

        case 'not-found':
          setScreenState({ mode: 'not-found' });
          return;

        case 'error':
          setScreenState({ mode: 'error', message: t('profile.editLoadError') });
          return;

        default:
          setScreenState({ mode: 'error', message: t('profile.editLoadError') });
      }
    } catch {
      setScreenState({ mode: 'error', message: t('profile.editLoadError') });
    }
  }, [tokenStorage, apiBaseUrl, onSessionExpired, t]);

  useEffect(() => {
    void doEntryGet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Validate fields ────────────────────────────────────────────────────────
  function validateAllFields(): boolean {
    const firstErr = validateNameInput(formState.motherFirstName);
    const lastErr = validateNameInput(formState.motherLastName);
    const babyErr = validateNameInput(formState.babyName);

    setErrors({
      motherFirstName: firstErr ? t(firstErr as Parameters<typeof t>[0]) : null,
      motherLastName: lastErr ? t(lastErr as Parameters<typeof t>[0]) : null,
      babyName: babyErr ? t(babyErr as Parameters<typeof t>[0]) : null,
    });

    return firstErr === null && lastErr === null && babyErr === null;
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (screenState.mode !== 'show-form') return;

    if (!validateAllFields()) return;

    setSaveError(null);
    setScreenState({ mode: 'saving' });

    const tokens = await tokenStorage.load();
    const accessToken = tokens?.accessToken;

    if (!accessToken) {
      // No token → session expired (SD-5)
      onSessionExpired();
      return;
    }

    // Capture profile now (from show-form state, before we transition to saving)
    const activeProfile = screenState.profile;

    try {
      const client = createPregnancyClient(apiBaseUrl);
      const clientDate = localCivilToday();
      const body = buildInfoEditPutInput(activeProfile, formState);
      const ifMatch = String(activeProfile.version);

      const result = await client.putProfile(body, accessToken, ifMatch, clientDate);
      const outcome = resolveInfoEditPutOutcome(result);

      switch (outcome.type) {
        case 'saved':
          onSaveComplete(outcome.profile);
          return;

        case 'session-expired':
          onSessionExpired();
          return;

        case 'conflict':
          // DEF-001 fix: store conflict message in ref so doEntryGet can apply
          // it AFTER the re-fetch resolves to show-form. Calling setSaveError
          // here would be cleared by doEntryGet's synchronous setScreenState
          // ({ mode: 'loading' }) in the same React 18 auto-batch (last-write-
          // wins = null). The ref survives the async boundary safely.
          pendingErrorRef.current = t('profileInfo.error.conflict');
          void doEntryGet();
          return;

        case 'precondition':
        case 'generic-error':
          setSaveError(t('profileInfo.error.generic'));
          setScreenState({ mode: 'show-form', profile: activeProfile });
          return;
      }
    } catch {
      setSaveError(t('profileInfo.error.generic'));
      setScreenState({ mode: 'show-form', profile: activeProfile });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenState, formState, tokenStorage, apiBaseUrl, onSessionExpired, onSaveComplete, t]);

  // ── Render helpers ─────────────────────────────────────────────────────────

  function renderField(
    label: string,
    value: string,
    placeholder: string,
    onChangeText: (text: string) => void,
    error: string | null,
    testID?: string,
  ): React.JSX.Element {
    return (
      <View style={styles.fieldContainer}>
        <Text style={styles.fieldLabel}>
          {label}
          {'  '}
          <Text style={styles.optionalTag}>{t('profileInfo.field.optional')}</Text>
        </Text>
        <TextInput
          style={[styles.input, error ? styles.inputError : null]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#9CA3AF"
          maxLength={105} // slight buffer; strict 100-char validated before PUT
          autoCorrect={false}
          testID={testID}
        />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>
    );
  }

  // ── Render: loading ────────────────────────────────────────────────────────
  if (screenState.mode === 'loading') {
    return (
      <SafeAreaView style={styles.container} testID="profile-info-edit-loading">
        <ActivityIndicator size="large" color="#E91E8C" style={styles.loadingSpinner} />
        <Text style={styles.loadingText}>{t('profile.editLoading')}</Text>
      </SafeAreaView>
    );
  }

  // ── Render: not-found ──────────────────────────────────────────────────────
  if (screenState.mode === 'not-found') {
    return (
      <SafeAreaView style={styles.container} testID="profile-info-edit-not-found">
        <Text style={styles.errorMessage}>{t('profile.editNotFound')}</Text>
      </SafeAreaView>
    );
  }

  // ── Render: error ──────────────────────────────────────────────────────────
  if (screenState.mode === 'error') {
    return (
      <SafeAreaView style={styles.container} testID="profile-info-edit-error">
        <Text style={styles.errorMessage}>{screenState.message}</Text>
        <TouchableOpacity
          style={styles.retryBtn}
          onPress={() => void doEntryGet()}
          testID="profile-info-edit-retry-btn"
        >
          <Text style={styles.retryBtnText}>{t('profile.editLoadRetry')}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── Render: form (show-form + saving) ──────────────────────────────────────
  const isSaving = screenState.mode === 'saving';

  return (
    <SafeAreaView
      style={styles.container}
      testID="profile-info-edit-screen"
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoid}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Subtitle */}
          <Text style={styles.subtitle}>{t('profileInfo.subtitle')}</Text>

          {/* Mother first name */}
          {renderField(
            t('profileInfo.field.motherFirstName'),
            formState.motherFirstName,
            t('profileInfo.placeholder.motherFirstName'),
            (text) => {
              setFormState((prev) => ({ ...prev, motherFirstName: text }));
              setErrors((prev) => ({ ...prev, motherFirstName: null }));
            },
            errors.motherFirstName,
            'profile-info-edit-first-name-input',
          )}

          {/* Mother last name */}
          {renderField(
            t('profileInfo.field.motherLastName'),
            formState.motherLastName,
            t('profileInfo.placeholder.motherLastName'),
            (text) => {
              setFormState((prev) => ({ ...prev, motherLastName: text }));
              setErrors((prev) => ({ ...prev, motherLastName: null }));
            },
            errors.motherLastName,
            'profile-info-edit-last-name-input',
          )}

          {/* Baby name */}
          {renderField(
            t('profileInfo.field.babyName'),
            formState.babyName,
            t('profileInfo.placeholder.babyName'),
            (text) => {
              setFormState((prev) => ({ ...prev, babyName: text }));
              setErrors((prev) => ({ ...prev, babyName: null }));
            },
            errors.babyName,
            'profile-info-edit-baby-name-input',
          )}

          {/* Privacy note (PDPA user assurance) */}
          <Text style={styles.privacyNote}>{t('profileInfo.note.optional')}</Text>

          {/* Inline save error */}
          {saveError ? (
            <Text style={styles.saveErrorText} testID="profile-info-edit-save-error">
              {saveError}
            </Text>
          ) : null}

          {/* Save button */}
          <TouchableOpacity
            style={[styles.saveBtn, isSaving && styles.saveBtnDisabled]}
            onPress={() => void handleSave()}
            disabled={isSaving}
            testID="profile-info-edit-save-btn"
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.saveBtnText}>{t('profileInfo.save')}</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  keyboardAvoid: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    flexGrow: 1,
  },
  loadingSpinner: {
    marginTop: 60,
    marginBottom: 16,
  },
  loadingText: {
    textAlign: 'center',
    color: '#6B7280',
    fontSize: 14,
  },
  errorMessage: {
    margin: 20,
    textAlign: 'center',
    color: '#6B7280',
    fontSize: 14,
  },
  retryBtn: {
    marginHorizontal: 20,
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: '#E91E8C',
    borderRadius: 8,
    alignSelf: 'center',
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 24,
    lineHeight: 20,
  },
  fieldContainer: {
    marginBottom: 20,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 6,
  },
  optionalTag: {
    fontWeight: '400',
    color: '#9CA3AF',
    fontSize: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 16,
    color: '#111827',
    backgroundColor: '#FFFFFF',
  },
  inputError: {
    borderColor: '#EF4444',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 12,
    marginTop: 4,
  },
  privacyNote: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 8,
    marginBottom: 24,
    lineHeight: 18,
  },
  saveErrorText: {
    color: '#EF4444',
    fontSize: 14,
    marginBottom: 12,
    textAlign: 'center',
  },
  saveBtn: {
    backgroundColor: '#E91E8C',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  saveBtnDisabled: {
    backgroundColor: '#F9A8D4',
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
