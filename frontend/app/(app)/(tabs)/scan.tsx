import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * POST /v1/scans isn't wired up yet (per the brief: "not yet — build a
 * placeholder"). This screen exists so Scan has a home in the nav; the
 * real camera + OCR flow replaces this body, not the route.
 */
export default function ScanScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>📷</Text>
      <Text style={styles.title}>Camera scan is coming soon</Text>
      <Text style={styles.body}>
        Photo capture and OCR expiry-date extraction aren't wired up yet. Add items by hand for
        now — manual entry is the fallback the demo relies on anyway.
      </Text>
      <Pressable style={styles.button} onPress={() => router.push('/add')}>
        <Text style={styles.buttonText}>Add manually instead</Text>
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
    padding: 32,
    gap: 12,
  },
  icon: {
    fontSize: 48,
    marginBottom: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    color: '#777',
    textAlign: 'center',
    lineHeight: 20,
  },
  button: {
    marginTop: 12,
    backgroundColor: '#2e7d32',
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
