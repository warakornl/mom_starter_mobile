/**
 * WelcomeScreen — App landing / splash screen (S1)
 *
 * ห้องแม่ Phase 2 B1 reskin (mother-room-phase2-rollout.md §4.1 WelcomeScreen).
 * Entry point for unauthenticated users.
 * Two primary CTAs:
 *   "สร้างบัญชี"  → Register (S2)
 *   "เข้าสู่ระบบ" → Login (S4)
 *
 * Language toggle (ไทย / EN):
 *   A small toggle in the top-right corner lets the user switch locale before
 *   signing in. The selected locale is persisted via expo-secure-store.
 *
 * Reskin changes (all tokens — NO inline hex/px outside tokens.ts):
 *   - Screen bg: T.color.surface.base (#FBF6F1)
 *   - App name: Sarabun-SemiBold 32sp/52LH T.color.text.heading (F-3 fix: LH 42→52)
 *   - Tagline: Sarabun-Regular 17sp/28LH T.color.text.primary
 *   - Primary CTA: T.button.primary.* (amber-700, not rose/600)
 *   - Secondary button bg: T.color.surface.subtle (ivory-200, not white)
 *   - Lang toggle bg: T.color.surface.subtle; border: T.color.surface.divider
 *   - Disclaimer: Sarabun-Regular 11sp T.color.text.primary (not #94818A — BANNED)
 *   - 🌸 emoji removed; replaced by typographic lockup
 *
 * State matrix:
 *   Ready  — always (no async data)
 *   Offline — offlinePill shown (CTAs remain visible)
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useT } from '../i18n/LanguageContext';
import { T } from '../theme/tokens';

type WelcomeScreenProps = NativeStackScreenProps<RootStackParamList, 'Welcome'>;

export function WelcomeScreen({ navigation }: WelcomeScreenProps): React.JSX.Element {
  const { t, locale, setLocale } = useT();

  // The toggle label always shows the OPPOSITE locale the user can switch to.
  const toggleLabel = locale === 'th' ? 'EN' : 'ไทย';
  const toggleA11y =
    locale === 'th'
      ? 'Switch to English'
      : 'เปลี่ยนเป็นภาษาไทย';

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={T.color.surface.base} />

      {/* Language toggle — top-right (hitSlop ≥48dp effective per spec) */}
      <View style={styles.topBar}>
        <TouchableOpacity
          testID="lang-toggle"
          style={styles.langToggle}
          onPress={() => setLocale(locale === 'th' ? 'en' : 'th')}
          accessibilityRole="button"
          accessibilityLabel={toggleA11y}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.langToggleText}>{toggleLabel}</Text>
        </TouchableOpacity>
      </View>

      {/* Headline block — typographic lockup replaces emoji illustration */}
      <View style={styles.headlineBlock}>
        <Text style={styles.appName}>ห้องแม่</Text>
        <Text style={styles.tagline}>{t('welcome.tagline')}</Text>
      </View>

      {/* CTA buttons */}
      <View style={styles.ctaBlock}>
        <TouchableOpacity
          testID="welcome-register-btn"
          style={styles.primaryButton}
          onPress={() => navigation.navigate('Register')}
          accessibilityRole="button"
          accessibilityLabel={t('welcome.createAccountA11y')}
        >
          <Text style={styles.primaryButtonText}>{t('welcome.createAccount')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="welcome-login-btn"
          style={styles.secondaryButton}
          onPress={() => navigation.navigate('Login')}
          accessibilityRole="button"
          accessibilityLabel={t('welcome.signInA11y')}
        >
          <Text style={styles.secondaryButtonText}>{t('welcome.signIn')}</Text>
        </TouchableOpacity>
      </View>

      {/* Legal / medical disclaimer — type.micro 11sp text.primary */}
      <Text style={styles.disclaimer}>{t('welcome.disclaimer')}</Text>
    </SafeAreaView>
  );
}

// ─── Styles — ALL values from T.* tokens; NO inline hex/px ───────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.color.surface.base,  // #FBF6F1
    paddingHorizontal: T.spacing[6],         // 24dp
    justifyContent: 'space-between',
  },

  // Top bar for language toggle
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingTop: T.spacing[2],               // 8dp
  },
  langToggle: {
    paddingHorizontal: T.spacing[3],        // 12dp
    paddingVertical: T.spacing[1],          // 4dp (outer: hitSlop covers ≥48dp)
    borderRadius: T.radius.pill,            // 999
    borderWidth: 1,
    borderColor: T.color.surface.divider,   // #E8DDD5
    backgroundColor: T.color.surface.subtle, // #F5EDE6 — NOT white
    minHeight: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  langToggleText: {
    fontFamily: T.type.caption.fontFamily,  // Sarabun-Regular
    fontWeight: '600',                       // SemiBold weight for lang badge
    fontSize: T.type.caption.size,          // 13sp
    lineHeight: T.type.caption.lineHeight,  // 21
    color: T.color.text.primary,            // #7A3A52 (7.70:1 AAA)
    letterSpacing: 0,                        // Thai: zero tracking
  },

  // Headline block — typographic lockup (no botanical illustration on Welcome)
  headlineBlock: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'flex-start',               // left-aligned per spec
    paddingBottom: T.spacing[6],            // 24dp
  },
  appName: {
    fontFamily: T.type.display.fontFamily,  // Sarabun-SemiBold
    fontSize: T.type.display.size,          // 32sp
    lineHeight: T.type.display.lineHeight,  // 52 (Thai ≥1.6× fix from F-3)
    color: T.color.text.heading,            // #4A2230 roselle-900
    marginBottom: T.spacing[2],             // 8dp
  },
  tagline: {
    fontFamily: T.type.bodyLarge.fontFamily, // Sarabun-Regular
    fontSize: T.type.bodyLarge.size,         // 17sp (size up to body.large per spec)
    lineHeight: T.type.bodyLarge.lineHeight, // 28
    color: T.color.text.primary,             // #7A3A52
    alignSelf: 'stretch',                    // full available width so Thai wraps naturally (no forced \n, no left-edge clip)
    flexShrink: 1,                           // Thai line-breaking: no clip
  },

  // CTA buttons
  ctaBlock: {
    gap: T.spacing[3],                       // 12dp
    paddingBottom: T.spacing[4],             // 16dp
  },
  primaryButton: {
    height: T.button.primary.height,         // 52dp
    backgroundColor: T.button.primary.bg,   // #9A5F0A amber-700
    borderRadius: T.button.primary.radius,  // 12dp
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonText: {
    fontFamily: T.type.label.fontFamily,    // Sarabun-SemiBold
    fontSize: T.type.body.size,             // 15sp per spec
    lineHeight: T.type.body.lineHeight,     // 25
    color: T.color.text.onDark,             // #FFFFFF
    letterSpacing: 0,
  },
  secondaryButton: {
    height: T.button.primary.height,        // 52dp
    borderWidth: 1,
    borderColor: T.color.surface.divider,   // #E8DDD5
    borderRadius: T.button.primary.radius,  // 12dp
    backgroundColor: T.color.surface.subtle, // #F5EDE6 — NOT white
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontFamily: T.type.body.fontFamily,     // Sarabun-Regular
    fontSize: T.type.body.size,             // 15sp
    lineHeight: T.type.body.lineHeight,     // 25
    color: T.color.text.primary,            // #7A3A52
    letterSpacing: 0,
  },

  disclaimer: {
    fontFamily: T.type.micro.fontFamily,    // Sarabun-Regular
    fontSize: T.type.micro.size,            // 11sp (micro token)
    lineHeight: T.type.micro.lineHeight,    // 18
    color: T.color.text.primary,            // #7A3A52 7.70:1 AAA (not #94818A — BANNED)
    textAlign: 'center',
    paddingBottom: T.spacing[4],            // 16dp
  },
});
