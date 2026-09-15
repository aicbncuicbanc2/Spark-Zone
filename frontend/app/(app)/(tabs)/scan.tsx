import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HeaderLogo } from '../../../components/HeaderLogo';
import { LiquidButton } from '../../../components/LiquidButton';
import { colors } from '../../../lib/theme';

// This tab used to run its own single-photo scan (aimed at catching a
// barcode and the date in one shot). Now that a photo is never expected to
// carry both, the single-photo path is gone - this screen is just the
// entry point into the two-photo flow (brand+name, then the printed date)
// that already lives at /scan-product.
export default function ScanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <HeaderLogo />
      </View>

      <View style={styles.center}>
        <Ionicons name="camera-outline" size={100} color={colors.navy} style={styles.icon} />
        <Text style={styles.title}>Scan a product</Text>
        <Text style={styles.body}>
          Two quick photos: the product's name and brand, then the printed expiry date. You'll
          always get a chance to confirm or fix the date before it's saved.
        </Text>

        <LiquidButton
          label="Take photo"
          onPress={() => router.push({ pathname: '/scan-product', params: { source: 'camera' } })}
        />
        <LiquidButton
          label="Upload photo"
          variant="outline"
          onPress={() => router.push({ pathname: '/scan-product', params: { source: 'library' } })}
        />
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 10,
  },
  icon: {
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
  manualLink: {
    marginTop: 4,
    padding: 8,
  },
  manualLinkText: {
    color: colors.textMuted,
    fontSize: 13,
  },
});
