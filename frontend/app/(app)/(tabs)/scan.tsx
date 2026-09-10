import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useCreateScan } from '../../../lib/queries';
import { colors } from '../../../lib/theme';

async function pickImage(source: 'camera' | 'library') {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!permission.granted) {
    Alert.alert('Permission needed', `Allow ${source === 'camera' ? 'camera' : 'photo library'} access to scan a label.`);
    return null;
  }

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });

  if (result.canceled) return null;
  return result.assets[0];
}

export default function ScanScreen() {
  const router = useRouter();
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const scanMutation = useCreateScan();

  async function handlePick(source: 'camera' | 'library') {
    const asset = await pickImage(source);
    if (!asset) return;
    setPreviewUri(asset.uri);

    scanMutation.mutate(
      { uri: asset.uri },
      {
        onSuccess: (scan) => {
          setPreviewUri(null);
          if (scan.status === 'failed') {
            Alert.alert(
              'Could not read that label',
              scan.error_detail ?? 'Try a clearer, well-lit photo, or add the item manually.',
              [
                { text: 'Try again', style: 'cancel' },
                { text: 'Add manually', onPress: () => router.push('/add') },
              ]
            );
            return;
          }

          // Prefill and hand off to the add form — never auto-save an OCR
          // read. router params double as the "was this touched" baseline
          // add.tsx uses to decide date_source: 'ocr' vs 'user'.
          router.push({
            pathname: '/add',
            params: {
              scan_id: scan.scan_id,
              name: scan.suggested_item?.name ?? '',
              brand: scan.suggested_item?.brand ?? '',
              category_id: scan.suggested_item?.category_id ?? '',
              expiry_date: scan.extracted_expiry_date ?? '',
              needs_review: scan.needs_review ? '1' : '0',
              review_reason: scan.review_reason ?? '',
              alternatives: JSON.stringify(scan.alternatives.map((a) => a.value)),
            },
          });
        },
        onError: (error) => {
          setPreviewUri(null);
          Alert.alert('Scan failed', (error as Error).message);
        },
      }
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Image source={require('../../../assets/brand/wordmark.png')} style={styles.logo} resizeMode="contain" />
        <Pressable style={styles.helpButton} onPress={() => router.push('/scan-product')}>
          <Ionicons name="alert" size={18} color={colors.white} />
        </Pressable>
      </View>

      {previewUri ? <Image source={{ uri: previewUri }} style={styles.preview} /> : null}

      {scanMutation.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.navy} />
          <Text style={styles.statusText}>Reading the label…</Text>
        </View>
      ) : (
        <View style={styles.center}>
          <Ionicons name="camera-outline" size={120} color={colors.navy} style={styles.icon} />

          <Pressable style={styles.button} onPress={() => handlePick('camera')}>
            <Text style={styles.buttonText}>Take photo</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => handlePick('library')}>
            <Text style={[styles.buttonText, styles.secondaryButtonText]}>Choose from library</Text>
          </Pressable>
          <Pressable style={styles.manualLink} onPress={() => router.push('/add')}>
            <Text style={styles.manualLinkText}>Or add manually</Text>
          </Pressable>
        </View>
      )}
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
    paddingTop: 16,
  },
  logo: {
    width: 90,
    height: 30,
  },
  helpButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 10,
  },
  preview: {
    width: '100%',
    height: 220,
    backgroundColor: '#000',
  },
  icon: {
    marginBottom: 24,
  },
  statusText: {
    color: colors.textMuted,
    marginTop: 8,
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
