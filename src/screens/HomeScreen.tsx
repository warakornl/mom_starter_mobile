/**
 * HomeScreen — Placeholder dashboard (post-auth)
 *
 * This is a skeleton screen shown after successful login or email verification.
 * It will be replaced by the full calendar-home dashboard in a later slice.
 *
 * For now it:
 *   - Greets the user ("ยินดีต้อนรับ")
 *   - Provides a logout button that clears tokens and navigates back to Welcome
 *
 * Design tokens (design-system.md §1–§5):
 *   bg/warm-milk  #FBF6F1   App background
 *   ink           #3A2A30   Primary text
 *   ink/soft      #5F4A52   Secondary copy
 *   rose/600      #A8505A   Primary button fill
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
} from 'react-native';
import type { TokenStorage } from '../auth/tokenStorage';

interface HomeScreenProps {
  /** Shared secure token storage — cleared on logout. */
  tokenStorage: TokenStorage;
  /** Navigate back to Welcome screen (resets the stack). */
  onLogout: () => void;
}

export function HomeScreen({ tokenStorage, onLogout }: HomeScreenProps): React.JSX.Element {
  async function handleLogout() {
    try {
      await tokenStorage.clear();
    } catch {
      // Storage clear failure is non-fatal — still navigate out
    }
    onLogout();
  }

  function confirmLogout() {
    Alert.alert(
      'ออกจากระบบ',
      'คุณต้องการออกจากระบบใช่ไหม?',
      [
        { text: 'ยกเลิก', style: 'cancel' },
        { text: 'ออกจากระบบ', style: 'destructive', onPress: handleLogout },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Placeholder illustration */}
        <Text style={styles.illustration} accessibilityElementsHidden={true}>
          🌸
        </Text>

        <Text style={styles.welcome}>ยินดีต้อนรับ</Text>
        <Text style={styles.subtitle}>
          {'สมุดสีชมพูของคุณพร้อมแล้ว\nฟีเจอร์ต่างๆ จะมาเร็วๆ นี้'}
        </Text>

        {/* Placeholder sections — to be replaced with real dashboard widgets */}
        <View style={styles.placeholderCard}>
          <Text style={styles.placeholderCardText}>
            📅  ปฏิทินการตั้งครรภ์ — เร็วๆ นี้
          </Text>
        </View>
        <View style={styles.placeholderCard}>
          <Text style={styles.placeholderCardText}>
            💊  บันทึกยาและวิตามิน — เร็วๆ นี้
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={styles.logoutButton}
        onPress={confirmLogout}
        accessibilityRole="button"
        accessibilityLabel="ออกจากระบบ"
      >
        <Text style={styles.logoutButtonText}>ออกจากระบบ</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FBF6F1',
    paddingHorizontal: 24,
  },

  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },

  illustration: {
    fontSize: 72,
    lineHeight: 88,
    marginBottom: 8,
  },

  welcome: {
    fontFamily: 'IBMPlexSans-SemiBold',
    fontSize: 28,
    lineHeight: 38,
    color: '#3A2A30',
    textAlign: 'center',
  },

  subtitle: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 15,
    lineHeight: 23,
    color: '#5F4A52',
    textAlign: 'center',
    marginBottom: 8,
  },

  placeholderCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    padding: 16,
  },
  placeholderCardText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 14,
    color: '#5F4A52',
  },

  logoutButton: {
    height: 52,
    borderWidth: 1,
    borderColor: '#EBE1D9',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  logoutButtonText: {
    fontFamily: 'IBMPlexSans-Regular',
    fontSize: 16,
    color: '#5F4A52',
  },
});
