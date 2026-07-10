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
 *
 * Async orchestration lives in profileInfoEditRuntimeWiring.ts (runInfoEntryGet /
 * runInfoSave) so it can be tested without mounting this component. This component
 * is a thin shell: it owns React state, validation UI, and render only.
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
import {
  runInfoEntryGet,
  runInfoSave,
} from './profileInfoEditRuntimeWiring';
import { T } from '../theme/tokens';
import type { InfoScreenState } from './profileInfoEditRuntimeWiring';
import {
  validateNameInput,
} from './profileInfoEditLogic';
import type { NameFormState } from './profileInfoEditLogic';

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
  onSaveComplete: (profile: import('./types').PregnancyProfile) => void;
  /**
   * SD-5 (BLOCKING): Called on GET 401 or PUT 401 (no token or server-expired).
   * Caller MUST run the full performLogout teardown (clearTokens + ALL health stores)
   * then navigate.reset to Welcome. Reuse the exact runner from RootNavigator.
   */
  onSessionExpired: () => void;
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function ProfileInfoEditScreen({
  tokenStorage,
  apiBaseUrl,
  onSaveComplete,
  onSessionExpired,
}: ProfileInfoEditScreenProps): React.JSX.Element {
  const { t } = useT();

  // ── State ──────────────────────────────────────────────────────────────────
  const [screenState, setScreenState] = useState<InfoScreenState>({ mode: 'loading' });
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
  // Owned here; shared (by reference) with runInfoEntryGet and runInfoSave.
  // See profileInfoEditRuntimeWiring.ts for the full DEF-001 explanation.
  const pendingErrorRef = useRef<string | null>(null);

  // ── Entry GET ──────────────────────────────────────────────────────────────
  const doEntryGet = useCallback(async () => {
    await runInfoEntryGet({
      tokenStorage,
      apiBaseUrl,
      pendingErrorRef,
      loadErrorMessage: t('profile.editLoadError'),
      onSessionExpired,
      setScreenState,
      setFormState,
      setSaveError,
    });
  }, [tokenStorage, apiBaseUrl, onSessionExpired, t]);

  useEffect(() => {
    void doEntryGet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Validate fields ────────────────────────────────────────────────────────
  // UI-level validation: updates per-field error state and returns overall validity.
  // Stays in the component (uses setErrors + t, not in wiring scope).
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

    await runInfoSave({
      tokenStorage,
      apiBaseUrl,
      screenState,
      formState,
      pendingErrorRef,
      conflictMessage: t('profileInfo.error.conflict'),
      genericErrorMessage: t('profileInfo.error.generic'),
      onSessionExpired,
      onSaveComplete,
      setScreenState,
      setSaveError,
      runEntryGet: doEntryGet,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenState, formState, tokenStorage, apiBaseUrl, onSessionExpired, onSaveComplete, t, doEntryGet]);

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
          placeholderTextColor={T.input.placeholder}
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
        <ActivityIndicator size="large" color={T.color.accent.interactive} style={styles.loadingSpinner} />
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
              <ActivityIndicator size="small" color={T.color.text.onDark} />
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
// ห้องแม่ Phase 2 B4: all token references migrated to semantic T.* namespace.

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.color.surface.base,
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
    color: T.color.text.primary,
    fontSize: T.type.caption.size,
  },
  errorMessage: {
    margin: 20,
    textAlign: 'center',
    color: T.color.text.primary,
    fontSize: T.type.caption.size,
  },
  retryBtn: {
    marginHorizontal: 20,
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: T.button.primary.bg,
    borderRadius: T.radius.sm,
    alignSelf: 'center',
  },
  retryBtnText: {
    color: T.color.text.onDark,
    fontSize: T.type.caption.size,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: T.type.caption.size,
    color: T.color.text.primary,
    marginBottom: 24,
    lineHeight: T.type.caption.lineHeight,
  },
  fieldContainer: {
    marginBottom: 20,
  },
  fieldLabel: {
    fontSize: T.type.caption.size,
    fontWeight: '600',
    color: T.color.text.heading,
    marginBottom: 6,
  },
  optionalTag: {
    fontWeight: '400',
    color: T.color.text.primary,
    fontSize: T.type.micro.size,
  },
  input: {
    borderWidth: 1,
    borderColor: T.input.border.default,
    borderRadius: T.radius.sm,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: T.type.body.size,
    color: T.input.text,
    backgroundColor: T.input.bg,
  },
  inputError: {
    borderColor: T.input.border.error,
  },
  errorText: {
    color: T.input.errorText,
    fontSize: T.type.micro.size,
    marginTop: 4,
  },
  privacyNote: {
    fontSize: T.type.micro.size,
    color: T.color.text.primary,
    marginTop: 8,
    marginBottom: 24,
    lineHeight: T.type.micro.lineHeight,
  },
  saveErrorText: {
    color: T.input.errorText,
    fontSize: T.type.caption.size,
    marginBottom: 12,
    textAlign: 'center',
  },
  saveBtn: {
    backgroundColor: T.button.primary.bg,
    paddingVertical: 14,
    borderRadius: T.button.primary.radius,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: T.button.primary.height,
  },
  saveBtnDisabled: {
    backgroundColor: T.scrim.amber,
  },
  saveBtnText: {
    color: T.color.text.onDark,
    fontSize: T.type.body.size,
    fontWeight: '700',
  },
});
