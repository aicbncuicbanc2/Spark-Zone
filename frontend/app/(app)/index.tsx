import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../contexts/AuthContext';

/**
 * Placeholder landing screen — just proves sign-in/session-persistence/sign-out
 * end to end. Gets replaced by the real dashboard (GET /v1/dashboard) next.
 */
export default function AppHomeScreen() {
  const { session, signOut } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Signed in</Text>
      <Text style={styles.email}>{session?.user.email}</Text>
      <Pressable style={styles.button} onPress={signOut}>
        <Text style={styles.buttonText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  email: {
    fontSize: 15,
    color: '#666',
  },
  button: {
    marginTop: 16,
    backgroundColor: '#c0392b',
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
