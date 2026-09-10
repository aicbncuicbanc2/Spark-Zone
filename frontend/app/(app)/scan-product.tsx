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

import { useCreateScan, useIdentifyProduct } from '../../lib/queries';

// Two photos, zero typing (when both hit): one of the product's own
// front/branding to identify what it is, one of the printed expiry date to
// read when it expires. They're deliberately separate steps rather than one
// photo run through both endpoints — the two are rarely the same side of
// the package (branding on the front, expiry date on the back or bottom).

type Step = 'brand' | 'date';

async function pickImage(source: 'camera' | 'library') {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!permission.granted) {
    Alert.alert('Permission needed', `Allow ${source === 'camera' ? 'camera' : 'photo library'} access to take a photo.`);
    return null;
  }

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });

  if (result.canceled) return null;
  return result.assets[0];
}

export default function ScanProductScreen() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('brand');
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [brand, setBrand] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const identifyMutation = useIdentifyProduct();
  const scanMutation = useCreateScan();
  const isBusy = identifyMutation.isPending || scanMutation.isPending;

  async function handleBrandPhoto(source: 'camera' | 'library') {
    const asset = await pickImage(source);
    if (!asset) return;
    setPreviewUri(asset.uri);

    identifyMutation.mutate(
      { uri: asset.uri },
      {
        onSuccess: (result) => {
          setPreviewUri(null);
          // A miss on either is a normal result, not an error — Logo/Label
          // Detection are each precise when they hit but genuinely
          // inconsistent, and independent of each other. Either way the
          // user still confirms/types everything on /add.
          setBrand(result.brand);
          setCategoryId(result.category_id);
          setStep('date');
        },
        onError: (error) => {
          setPreviewUri(null);
          Alert.alert('Could not read that photo', (error as Error).message);
        },
      }
    );
  }

  async function handleDatePhoto(source: 'camera' | 'library') {
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

          router.push({
            pathname: '/add',
            params: {
              scan_id: scan.scan_id,
              // Name starts as just the brand (e.g. "Kopiko") rather than
              // anything parsed from OCR text — real testing showed the
              // most prominent OCR text block can be a misread brand or
              // unrelated background text, so it's still always editable
              // here, never a longer guessed-at product name.
              name: brand ?? scan.suggested_item?.name ?? '',
              brand: brand ?? scan.suggested_item?.brand ?? '',
              category_id: categoryId ?? scan.suggested_item?.category_id ?? '',
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

  const handlePick = step === 'brand' ? handleBrandPhoto : handleDatePhoto;

  return (
    <View style={styles.container}>
      {previewUri ? <Image source={{ uri: previewUri }} style={styles.preview} /> : null}

      {isBusy ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
          <Text style={styles.statusText}>
            {step === 'brand' ? 'Identifying the product…' : 'Reading the label…'}
          </Text>
        </View>
      ) : (
        <View style={styles.center}>
          <Text style={styles.stepIndicator}>Step {step === 'brand' ? '1' : '2'} of 2</Text>
          <Text style={styles.icon}>{step === 'brand' ? '🏷️' : '📅'}</Text>
          <Text style={styles.title}>
            {step === 'brand' ? "Photo of the product's front" : 'Photo of the expiry date'}
          </Text>
          <Text style={styles.body}>
            {step === 'brand'
              ? "The name and logo, not the expiry date — we'll ask for that next."
              : brand
                ? `Got it: ${brand}. Now the printed expiry date.`
                : "Couldn't identify the brand, that's okay — now the printed expiry date."}
          </Text>

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
    backgroundColor: '#fff',
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
  stepIndicator: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2e7d32',
    marginBottom: 4,
  },
  icon: {
    fontSize: 40,
    marginBottom: 4,
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
    marginBottom: 8,
  },
  statusText: {
    color: '#777',
    marginTop: 8,
  },
  button: {
    backgroundColor: '#2e7d32',
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingVertical: 12,
    width: '100%',
    alignItems: 'center',
  },
  secondaryButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#2e7d32',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  secondaryButtonText: {
    color: '#2e7d32',
  },
  manualLink: {
    marginTop: 4,
    padding: 8,
  },
  manualLinkText: {
    color: '#888',
    fontSize: 13,
  },
});
