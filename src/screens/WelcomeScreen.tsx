/**
 * WelcomeScreen — App landing / splash screen (S1)
 *
 * Entry point for unauthenticated users.
 * Two primary CTAs:
 *   "สร้างบัญชี"  → Register (S2)
 *   "เข้าสู่ระบบ" → Login (S4)
 *
 * Language toggle (ไทย / EN):
 *   A small toggle in the top-right corner lets the user switch locale before
 *   signing in. The selected locale is persisted via expo-secure-store.
 *
 * Design tokens (design-system.md §1–§5):
 *   bg/warm-milk  #FBF6F1   App background
 *   ink           #3A2A30   Primary text
 *   ink/soft      #5F4A52   Secondary copy
 *   rose/600      #A8505A   Primary button fill
 *   hairline      #EBE1D9   Secondary button border
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
      <StatusBar barStyle="dark-content" backgroundColor="#FBF6F1" />

      {/* Language toggle — top-right */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.langToggle}
          onPress={() => setLocale(locale === 'th' ? 'en' : 'th')}
          accessibilityRole="button"
          accessibilityLabel={toggleA11y}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.langToggleText}>{toggleLabel}</Text>
        </TouchableOpacity>
      </View>

      {/* Illustration area — placeholder until SVG assets land */}
      <View style={styles.illustrationArea} accessibilityElementsHidden={true}>
        <Text style={styles.illustrationEmoji}>🌸</Text>
      </View>

      {/* Headline block */}
      <View style={styles.headlineBlock}>
        <Text style={styles.appName}>Mom-Starter</Text>
        <Text style={styles.tagline}>{t('welcome.tagline')}</Text>
      </View>

      {/* CTA buttons */}
      <View style={styles.ctaBlock}>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => navigation.navigate('Register')}
          accessibilityRole="button"
          accessibilityLabel={t('welcome.createAccountA11y')}
        >
          <Text style={styles.primaryButtonText}>{t('welcome.createAccount')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => navigation.navigate('Login')}
          accessibilityRole="button"
          accessibilityLabel={t('welcome.signInA11y')}
        >
          <Text style={styles.secondaryButtonText}>{t('welcome.signIn')}</Text>
        </TouchableOpacity>
      </View>

      {/* Legal / medical disclaimer */}
      <Text style={styles.disclaimer}>{t('welcome.disclaimer')}</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FBF6F1',
    paddingHorizontal: 24,
    justifyContent: 'space-between',
  },

  // Top bar for language toggle
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingTop: 8,
  },
  langToggle: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    backgroundColor: '#FFFFFF',
    minHeight: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  langToggleText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 13,
    color: '#5F4A52',
    letterSpacing: 0.3,
  },

  illustrationArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 20,
  },
  illustrationEmoji: {
    fontSize: 96,
    lineHeight: 120,
  },

  headlineBlock: {
    alignItems: 'center',
    paddingBottom: 24,
  },
  appName: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 32,
    lineHeight: 42,
    color: '#3A2A30',
    marginBottom: 8,
  },
  tagline: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    lineHeight: 24,
    color: '#5F4A52',
    textAlign: 'center',
  },

  ctaBlock: {
    gap: 12,
    paddingBottom: 16,
  },
  primaryButton: {
    height: 52,
    backgroundColor: '#A8505A',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonText: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 16,
    color: '#FFFFFF',
  },
  secondaryButton: {
    height: 52,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    color: '#3A2A30',
  },

  disclaimer: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 12,
    color: '#94818A',
    textAlign: 'center',
    paddingBottom: 16,
  },
});
