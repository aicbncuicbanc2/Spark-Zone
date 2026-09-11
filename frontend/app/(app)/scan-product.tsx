import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useCreateScan, useIdentifyProduct } from '../../lib/queries';
import { colors } from '../../lib/theme';
import type { BrandBox } from '../../lib/types';

// Two photos, zero typing (when both hit): one of the product's own
// front/branding to identify what it is, one of the printed expiry date to
// read when it expires. They're deliberately separate steps rather than one
// photo run through both endpoints — the two are rarely the same side of
// the package (branding on the front, expiry date on the back or bottom).
//
// Between them sits a "confirm" step whenever Vision found the logo: the
// photo is shown again with a frame drawn over the exact region Vision
// detected, so the user confirms the *real* detection rather than trusting
// it blindly. There's deliberately no equivalent frame for "the product
// name" — Vision detects text, not what that text means, so there's no
// reliable region to point to the way there is for a logo (see
// backend/app/services/ocr/vision_engine.py's ProductIdentification).

type Step = 'brand' | 'confirm' | 'date';

const FALLBACK_ASPECT_RATIO = 4 / 3;

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

function StepDots({ step }: { step: Step }) {
  const onDateStep = step === 'date';
  return (
    <View style={styles.stepDots}>
      <View style={[styles.stepDot, styles.stepDotFilled]} />
      <View style={[styles.stepDotTrack, onDateStep && styles.stepDotTrackFilled]} />
      <View style={[styles.stepDot, onDateStep && styles.stepDotFilled]} />
    </View>
  );
}

export default function ScanProductScreen() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('brand');
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewAspectRatio, setPreviewAspectRatio] = useState(FALLBACK_ASPECT_RATIO);
  const [brand, setBrand] = useState<string | null>(null);
  const [brandBox, setBrandBox] = useState<BrandBox | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);

  const identifyMutation = useIdentifyProduct();
  const scanMutation = useCreateScan();
  const isBusy = identifyMutation.isPending || scanMutation.isPending;

  async function handleBrandPhoto(source: 'camera' | 'library') {
    const asset = await pickImage(source);
    if (!asset) return;
    setPreviewUri(asset.uri);
    // Some pickers/platforms genuinely can't report dimensions (0x0) - fall
    // back to a plausible default rather than an invalid aspect ratio.
    setPreviewAspectRatio(
      asset.width && asset.height ? asset.width / asset.height : FALLBACK_ASPECT_RATIO
    );

    identifyMutation.mutate(
      { uri: asset.uri },
      {
        onSuccess: (result) => {
          // A miss on either is a normal result, not an error — Logo/Label
          // Detection are each precise when they hit but genuinely
          // inconsistent, and independent of each other. Either way the
          // user still confirms/types everything on /add.
          setBrand(result.brand);
          setBrandBox(result.brand_box);
          setCategoryId(result.category_id);
          setRawText(result.raw_text);
          if (result.brand_box) {
            // Something real to show the user - keep the photo on screen
            // and let them confirm the actual detected region, rather than
            // silently trusting it and moving straight on.
            setStep('confirm');
          } else {
            setPreviewUri(null);
            setStep('date');
          }
        },
        onError: (error) => {
          setPreviewUri(null);
          Alert.alert('Could not read that photo', (error as Error).message);
        },
      }
    );
  }

  function handleConfirmBrand() {
    setPreviewUri(null);
    setStep('date');
  }

  function handleRetakeBrand() {
    setPreviewUri(null);
    setBrand(null);
    setBrandBox(null);
    setCategoryId(null);
    setRawText(null);
    setStep('brand');
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

  if (step === 'confirm') {
    return (
      <View style={styles.container}>
        <StepDots step={step} />
        {/* A tall portrait photo (very common - phones default to it) can
            easily be taller than the screen once sized by its own real
            aspect ratio. A plain View here left the confirm/retake buttons
            genuinely unreachable below the fold, with nothing to scroll -
            this must be a ScrollView so the buttons are always reachable
            regardless of the photo's proportions. */}
        <ScrollView contentContainerStyle={styles.confirmScrollContent}>
          <Text style={styles.stepIndicator}>Step 1 of 2</Text>
          <Text style={styles.title}>Is this the brand?</Text>
          <Text style={styles.body}>We found "{brand}" in the highlighted area.</Text>

          {previewUri && (
            <View style={[styles.confirmImageWrap, { aspectRatio: previewAspectRatio }]}>
              <Image source={{ uri: previewUri }} style={styles.confirmImage} resizeMode="contain" />
              {brandBox && (
                <View
                  pointerEvents="none"
                  style={[
                    styles.brandFrame,
                    {
                      left: `${brandBox.x * 100}%`,
                      top: `${brandBox.y * 100}%`,
                      width: `${brandBox.width * 100}%`,
                      height: `${brandBox.height * 100}%`,
                    },
                  ]}
                />
              )}
            </View>
          )}

          <Pressable style={styles.button} onPress={handleConfirmBrand}>
            <Text style={styles.buttonText}>Yes, that's right</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.secondaryButton]} onPress={handleRetakeBrand}>
            <Text style={[styles.buttonText, styles.secondaryButtonText]}>No, retake the photo</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StepDots step={step} />

      {previewUri ? (
        <View style={styles.previewWrap}>
          <Image source={{ uri: previewUri }} style={styles.preview} />
        </View>
      ) : null}

      {isBusy ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.navy} />
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

          {step === 'date' && !brand && rawText && (
            // Brand detection misses often enough (it depends on Google's
            // logo database, which doesn't cover every brand) that leaving
            // the user with nothing is worse than a raw hint they can read
            // and copy themselves — this is shown as-is, never auto-filled,
            // since the same photo can also pick up unrelated background
            // text from other products in frame.
            <View style={styles.hintBox}>
              <Text style={styles.hintLabel}>We also saw this text on the photo:</Text>
              <Text style={styles.hintText} numberOfLines={4}>
                {rawText}
              </Text>
            </View>
          )}

          <Pressable style={styles.button} onPress={() => handlePick('camera')}>
            <Text style={styles.buttonText}>Take photo</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => handlePick('library')}>
            <Text style={[styles.buttonText, styles.secondaryButtonText]}>Choose from library</Text>
          </Pressable>

          {step === 'date' && (
            <Pressable style={styles.manualLink} onPress={() => setStep('brand')}>
              <Text style={styles.manualLinkText}>← Retake the product photo</Text>
            </Pressable>
          )}
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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 10,
  },
  confirmScrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 10,
  },
  stepDots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 20,
    gap: 4,
  },
  stepDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.border,
  },
  stepDotFilled: {
    backgroundColor: colors.navy,
  },
  stepDotTrack: {
    width: 32,
    height: 2,
    backgroundColor: colors.border,
  },
  stepDotTrackFilled: {
    backgroundColor: colors.navy,
  },
  previewWrap: {
    marginHorizontal: 24,
    marginTop: 16,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  preview: {
    width: '100%',
    height: 220,
  },
  confirmImageWrap: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000',
    marginVertical: 8,
    // aspectRatio is set inline per-photo, from the picked asset's real
    // dimensions - without it the container would either crop the image
    // (misaligning the frame below) or letterbox it (same problem).
  },
  confirmImage: {
    width: '100%',
    height: '100%',
  },
  brandFrame: {
    position: 'absolute',
    borderWidth: 3,
    borderColor: colors.danger,
    borderRadius: 4,
  },
  stepIndicator: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.navy,
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
    color: colors.navy,
  },
  body: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 8,
  },
  statusText: {
    color: colors.textMuted,
    marginTop: 8,
    textAlign: 'center',
  },
  hintBox: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    width: '100%',
    marginBottom: 4,
  },
  hintLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 4,
  },
  hintText: {
    fontSize: 13,
    color: colors.navy,
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
