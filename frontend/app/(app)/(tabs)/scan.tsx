import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../lib/theme';

// This tab used to run its own single-photo scan (aimed at catching a
// barcode and the date in one shot). Now that a photo is never expected to
// carry both, the single-photo path is gone - this screen is just the
// entry point into the two-photo flow (brand+name, then the printed date)
// that already lives at /scan-product.
export default function ScanScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.center}>
        <Text style={styles.icon}>📷</Text>
        <Text style={styles.title}>Scan a product</Text>
        <Text style={styles.body}>
          Two quick photos: the product's name and brand, then the printed expiry date. You'll
          always get a chance to confirm or fix the date before it's saved.
        </Text>

        <Pressable
          style={styles.button}
          onPress={() => router.push({ pathname: '/scan-product', params: { source: 'camera' } })}
        >
          <Text style={styles.buttonText}>Take photo</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.secondaryButton]}
          onPress={() => router.push({ pathname: '/scan-product', params: { source: 'library' } })}
        >
          <Text style={[styles.buttonText, styles.secondaryButtonText]}>Upload photo</Text>
        </Pressable>
        <Pressable style={styles.manualLink} onPress={() => router.push('/add')}>
          <Text style={styles.manualLinkText}>Or add manually</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 10,
  },
  icon: {
    fontSize: 40,
    marginBottom: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    color: colors.navy,
  },
  body: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 8,
  },
  button: {
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingVertical: 12,
    width: '100%',
    alignItems: 'center',
  },
  secondaryButton: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.navy,
  },
  buttonText: {
    color: colors.white,
    fontWeight: '600',
  },
  secondaryButtonText: {
    color: colors.navy,
  },
  manualLink: {
    marginTop: 4,
    padding: 8,
  },
  manualLinkText: {
    color: colors.textMuted,
    fontSize: 13,
  },
});
