import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { type AlertState, resolveWebAlert, subscribeToAlerts } from '../lib/alert';
import { colors } from '../lib/theme';

/**
 * Renders the dialog for lib/alert.ts's web fallback. A no-op on native,
 * where the real Alert.alert already draws its own native dialog - this
 * only exists because react-native-web's Alert doesn't. Mount once, at
 * the app root, so every screen's `alert(...)` call reaches it regardless
 * of which route is active.
 */
export function AppAlertHost() {
  const [state, setState] = useState<AlertState | null>(null);

  useEffect(() => subscribeToAlerts(setState), []);

  if (Platform.OS !== 'web' || !state) return null;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => setState(null)}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{state.title}</Text>
          {state.message ? <Text style={styles.message}>{state.message}</Text> : null}
          <View style={styles.buttonColumn}>
            {state.buttons.map((button, index) => (
              <Pressable
                key={`${button.text}-${index}`}
                style={[
                  styles.button,
                  button.style === 'cancel' && styles.buttonSecondary,
                  button.style === 'destructive' && styles.buttonDestructive,
                ]}
                onPress={() => resolveWebAlert(button)}
              >
                <Text style={[styles.buttonText, button.style === 'cancel' && styles.buttonTextSecondary]}>
                  {button.text}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 20,
    gap: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.navy,
  },
  message: {
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
  },
  buttonColumn: {
    marginTop: 12,
    gap: 8,
  },
  button: {
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonSecondary: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.navy,
  },
  buttonDestructive: {
    backgroundColor: colors.danger,
  },
  buttonText: {
    color: colors.white,
    fontWeight: '600',
    fontSize: 15,
  },
  buttonTextSecondary: {
    color: colors.navy,
  },
});
