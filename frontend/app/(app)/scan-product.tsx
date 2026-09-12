import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { CropFrame, type CropRect } from '../../components/CropFrame';
import { alert } from '../../lib/alert';
import { useCreateScan, useIdentifyProduct } from '../../lib/queries';
import { colors, fontSize } from '../../lib/theme';
import type { ScanResponse } from '../../lib/types';

// Two photos, zero typing (when both hit): one of the product's own
// front/branding to identify what it is, one of the printed expiry date to
// read when it expires. They're deliberately separate steps rather than one
// photo run through both endpoints — the two are rarely the same side of
// the package (branding on the front, expiry date on the back or bottom).
//
// Before each photo is sent to the backend, the user drags/resizes a frame
// over the exact region that matters (name+logo, or the printed date) and
// only that cropped region is analyzed. This is what real testing showed
// was needed: OCR/logo detection run over a whole front-of-package photo
// can pick up an unrelated brand elsewhere in frame or background clutter
// from other shelf products, and the user is in a far better position than
// either engine to say "the date is right here."
//
// After a brand crop that identifies something, a lightweight "confirm"
// step shows the cropped photo again so the user can retake if the crop
// missed — no box overlay needed there since the whole shown image already
// *is* the region the user selected.

type Step = 'brand' | 'frame' | 'confirm' | 'date';
type FrameTarget = 'brand' | 'date';

const FALLBACK_ASPECT_RATIO = 4 / 3;
const MAX_HINT_CANDIDATES = 8;
const MAX_HINT_LENGTH = 30;

// Turns raw OCR text into short, tappable candidates for "which of these is
// the brand/product name?" - one per line (that's how Vision naturally
// groups distinct text blocks), deduplicated, and long lines dropped since
// a paragraph-length block is never itself a brand name.
function hintCandidates(rawText: string): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const rawLine of rawText.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.length > MAX_HINT_LENGTH || seen.has(line)) continue;
    seen.add(line);
    candidates.push(line);
    if (candidates.length >= MAX_HINT_CANDIDATES) break;
  }
  return candidates;
}

function computeDisplayBox(imageWidth: number, imageHeight: number) {
  const window = Dimensions.get('window');
  const maxWidth = window.width - 64;
  const maxHeight = window.height * 0.5;
  const aspectRatio = imageWidth / imageHeight;
  let width = maxWidth;
  let height = width / aspectRatio;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * aspectRatio;
  }
  return { width, height };
}

function initialCropRect(displayWidth: number, displayHeight: number, target: FrameTarget): CropRect {
  // A printed date line usually reads "EXP 22/12/2027" or similar - the
  // label and the digits together, not just the digits. Starting the date
  // frame taller than a single tight text line leaves room for that label
  // to already be inside it, since a date read with no label at all can't
  // be told apart from a manufacture date and won't auto-fill the form.
  const widthFraction = 0.85;
  const heightFraction = target === 'date' ? 0.35 : 0.5;
  const width = displayWidth * widthFraction;
  const height = displayHeight * heightFraction;
  return { x: (displayWidth - width) / 2, y: (displayHeight - height) / 2, width, height };
}

async function pickImage(source: 'camera' | 'library') {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!permission.granted) {
    alert('Permission needed', `Allow ${source === 'camera' ? 'camera' : 'photo library'} access to take a photo.`);
    return null;
  }

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });

  if (result.canceled) return null;
  return result.assets[0];
}

function StepDots({ stageTwo }: { stageTwo: boolean }) {
  return (
    <View style={styles.stepDots}>
      <View style={[styles.stepDot, styles.stepDotFilled]} />
      <View style={[styles.stepDotTrack, stageTwo && styles.stepDotTrackFilled]} />
      <View style={[styles.stepDot, stageTwo && styles.stepDotFilled]} />
    </View>
  );
}

export default function ScanProductScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ source?: string }>();
  const [step, setStep] = useState<Step>('brand');
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewAspectRatio, setPreviewAspectRatio] = useState(FALLBACK_ASPECT_RATIO);
  const [brand, setBrand] = useState<string | null>(null);
  // Whether Logo/Label Detection itself actually found a brand - separate
  // from `brand`, which the user can also fill in afterwards by tapping one
  // of the raw-OCR-text hints below. Only gates whether that hint UI shows
  // at all: a real detection hit means there's nothing to fall back to.
  const [brandDetected, setBrandDetected] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);
  const [unit, setUnit] = useState<string | null>(null);

  // The frame step's working state: the just-picked photo awaiting a crop
  // decision, its real pixel size (needed to convert the on-screen frame
  // into a real crop rectangle), the on-screen box it's displayed at, the
  // frame itself, which stage it's for, and whether a crop is in flight.
  const [pendingUri, setPendingUri] = useState<string | null>(null);
  const [pendingSize, setPendingSize] = useState<{ width: number; height: number } | null>(null);
  const [displaySize, setDisplaySize] = useState<{ width: number; height: number } | null>(null);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [frameTarget, setFrameTarget] = useState<FrameTarget | null>(null);
  const [isCropping, setIsCropping] = useState(false);

  const identifyMutation = useIdentifyProduct();
  const scanMutation = useCreateScan();
  const isBusy = identifyMutation.isPending || scanMutation.isPending;

  function resetFrameState() {
    setPendingUri(null);
    setPendingSize(null);
    setDisplaySize(null);
    setCropRect(null);
    setFrameTarget(null);
  }

  function goToAddScreen(scan: ScanResponse) {
    // extracted_expiry_date is deliberately null whenever the OCR reading
    // can't be confirmed as an expiry (no EXP/MFG keyword found near it at
    // all - common once the crop step above is tight around just the
    // digits). That's still a real date the backend found, just not one
    // it will silently promote - fall back to it here (never to a
    // "manufacture" one, which is a confirmed non-expiry) so the field
    // isn't left blank, with needs_review carrying the "please confirm
    // this" flag through.
    const fallbackDate = scan.alternatives.find((a) => a.date_type !== 'manufacture')?.value;

    router.push({
      pathname: '/add',
      params: {
        scan_id: scan.scan_id,
        // Name starts as just the brand (e.g. "Kopiko") rather than
        // anything parsed from OCR text — real testing showed the most
        // prominent OCR text block can be a misread brand or unrelated
        // background text, so it's still always editable here, never a
        // longer guessed-at product name.
        name: brand ?? scan.suggested_item?.name ?? '',
        brand: brand ?? scan.suggested_item?.brand ?? '',
        category_id: categoryId ?? scan.suggested_item?.category_id ?? '',
        unit: unit ?? '',
        expiry_date: scan.extracted_expiry_date ?? fallbackDate ?? '',
        needs_review: scan.needs_review ? '1' : '0',
        review_reason: scan.review_reason ?? '',
        alternatives: JSON.stringify(scan.alternatives.map((a) => a.value)),
      },
    });
  }

  function applyBrandResult(result: {
    brand: string | null;
    category_id: string | null;
    raw_text: string | null;
    unit: string | null;
  }) {
    // A miss is a normal result, not an error — Logo/Label Detection are
    // each precise when they hit but genuinely inconsistent. Either way
    // the user still confirms/types everything on /add.
    setBrand(result.brand);
    setBrandDetected(!!result.brand);
    setCategoryId(result.category_id);
    setRawText(result.raw_text);
    setUnit(result.unit);
    if (result.brand) {
      setStep('confirm');
    } else {
      setPreviewUri(null);
      setStep('date');
    }
  }

  function runIdentifyOrScan(uri: string, target: FrameTarget) {
    setPreviewUri(uri);
    if (target === 'brand') {
      identifyMutation.mutate(
        { uri },
        {
          onSuccess: applyBrandResult,
          onError: (error) => {
            setPreviewUri(null);
            alert('Could not read that photo', (error as Error).message);
          },
        }
      );
    } else {
      scanMutation.mutate(
        { uri },
        {
          onSuccess: (scan) => {
            setPreviewUri(null);
            if (scan.status === 'failed') {
              alert(
                'Could not read that label',
                scan.error_detail ?? 'Try a clearer, well-lit photo, or add the item manually.',
                [
                  { text: 'Try again', style: 'cancel' },
                  { text: 'Add manually', onPress: () => router.push('/add') },
                ]
              );
              return;
            }

            goToAddScreen(scan);
          },
          onError: (error) => {
            setPreviewUri(null);
            alert('Scan failed', (error as Error).message);
          },
        }
      );
    }
  }

  function startFrameStep(asset: ImagePicker.ImagePickerAsset, target: FrameTarget) {
    if (!asset.width || !asset.height) {
      // Some pickers/platforms genuinely can't report dimensions - without
      // real pixels there's no reliable way to convert an on-screen frame
      // into a crop rectangle, so fall back to sending the whole photo.
      setPreviewAspectRatio(FALLBACK_ASPECT_RATIO);
      runIdentifyOrScan(asset.uri, target);
      return;
    }
    const display = computeDisplayBox(asset.width, asset.height);
    setPendingUri(asset.uri);
    setPendingSize({ width: asset.width, height: asset.height });
    setDisplaySize(display);
    setCropRect(initialCropRect(display.width, display.height, target));
    setFrameTarget(target);
    setStep('frame');
  }

  async function handleBrandPhoto(source: 'camera' | 'library') {
    const asset = await pickImage(source);
    if (!asset) return;
    startFrameStep(asset, 'brand');
  }

  // The Scan tab's "Take photo"/"Upload photo" buttons pass which source
  // the user already chose, so tapping one opens the camera/library
  // immediately instead of landing here and asking the same question
  // again. Only ever fires once per visit - autoStartedRef survives
  // re-renders without itself triggering one, unlike state.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (params.source !== 'camera' && params.source !== 'library') return;
    autoStartedRef.current = true;
    handleBrandPhoto(params.source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.source]);

  async function handleDatePhoto(source: 'camera' | 'library') {
    const asset = await pickImage(source);
    if (!asset) return;
    startFrameStep(asset, 'date');
  }

  async function handleUseCrop() {
    if (!pendingUri || !pendingSize || !displaySize || !cropRect || !frameTarget) return;
    const target = frameTarget;
    const originalUri = pendingUri;
    const scaleX = pendingSize.width / displaySize.width;
    const scaleY = pendingSize.height / displaySize.height;
    const originX = Math.round(cropRect.x * scaleX);
    const originY = Math.round(cropRect.y * scaleY);
    const width = Math.round(cropRect.width * scaleX);
    const height = Math.round(cropRect.height * scaleY);

    setIsCropping(true);
    try {
      const context = ImageManipulator.ImageManipulator.manipulate(originalUri);
      context.crop({ originX, originY, width, height });
      const rendered = await context.renderAsync();
      const croppedResult = await rendered.saveAsync();
      setPreviewAspectRatio(width / height);
      resetFrameState();
      setStep(target);

      if (target === 'date') {
        runIdentifyOrScan(croppedResult.uri, target);
        return;
      }

      // Brand: Logo/Text Detection benefit from the tight crop the user
      // just drew, but Label Detection (which category comes from) needs
      // the product's full packaging in view to recognise what kind of
      // thing it even is - a crop tight enough to isolate just a logo or
      // wordmark starves it of that context (confirmed against a real
      // scan: cropping to just "Sunlight" returned no category, where the
      // same photo uncropped had returned "household" before). Run both
      // and take brand from the crop, category from the original photo,
      // rather than making one image serve both jobs.
      setPreviewUri(croppedResult.uri);
      const [cropHit, fullHit] = await Promise.all([
        identifyMutation.mutateAsync({ uri: croppedResult.uri }),
        identifyMutation.mutateAsync({ uri: originalUri }),
      ]);
      applyBrandResult({
        brand: cropHit.brand,
        category_id: fullHit.category_id,
        raw_text: cropHit.raw_text,
        // Same reasoning as category above: the packaging-unit guess comes
        // from the same Label Detection pass, so it needs the full product
        // in view too, not just the tight brand/logo crop.
        unit: fullHit.unit,
      });
    } catch (error) {
      setPreviewUri(null);
      alert('Could not read that photo', (error as Error).message);
    } finally {
      setIsCropping(false);
    }
  }

  function handleUseWholePhoto() {
    if (!pendingUri || !frameTarget) return;
    const target = frameTarget;
    const uri = pendingUri;
    if (pendingSize) setPreviewAspectRatio(pendingSize.width / pendingSize.height);
    resetFrameState();
    setStep(target);
    runIdentifyOrScan(uri, target);
  }

  function handleRetakeFromFrame() {
    const target = frameTarget ?? 'brand';
    resetFrameState();
    setStep(target);
  }

  function handleConfirmBrand() {
    setPreviewUri(null);
    setStep('date');
  }

  function handleRetakeBrand() {
    setPreviewUri(null);
    setBrand(null);
    setBrandDetected(false);
    setCategoryId(null);
    setRawText(null);
    setUnit(null);
    setStep('brand');
  }

  const handlePick = step === 'brand' ? handleBrandPhoto : handleDatePhoto;

  if (step === 'frame' && pendingUri && displaySize && cropRect) {
    const isDate = frameTarget === 'date';
    return (
      <View style={styles.container}>
        <StepDots stageTwo={isDate} />
        <ScrollView contentContainerStyle={styles.confirmScrollContent}>
          <Text style={styles.stepIndicator}>Step {isDate ? '2' : '1'} of 2</Text>
          <Text style={styles.title}>
            {isDate ? 'Drag the frame over the expiry date' : 'Drag the frame over the name and brand'}
          </Text>
          <Text style={styles.body}>
            {isDate
              ? "Move and resize it so it covers the date together with any label next to it, like \"EXP\" or \"MFG\" — not just the digits. Only what's inside gets scanned."
              : "Move and resize it so it covers just the product name and logo — only what's inside gets scanned."}
          </Text>

          <View style={[styles.frameImageWrap, { width: displaySize.width, height: displaySize.height }]}>
            <Image source={{ uri: pendingUri }} style={styles.confirmImage} resizeMode="contain" />
            <CropFrame
              displayWidth={displaySize.width}
              displayHeight={displaySize.height}
              rect={cropRect}
              onChange={setCropRect}
            />
          </View>

          <Pressable style={styles.button} onPress={handleUseCrop} disabled={isCropping}>
            {isCropping ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.buttonText}>Use this area</Text>
            )}
          </Pressable>
          <Pressable style={[styles.button, styles.secondaryButton]} onPress={handleUseWholePhoto} disabled={isCropping}>
            <Text style={[styles.buttonText, styles.secondaryButtonText]}>Use the whole photo instead</Text>
          </Pressable>
          <Pressable style={styles.manualLink} onPress={handleRetakeFromFrame} disabled={isCropping}>
            <Text style={styles.manualLinkText}>← Retake the photo</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  if (step === 'confirm') {
    return (
      <View style={styles.container}>
        <StepDots stageTwo={false} />
        {/* A tall portrait photo (very common - phones default to it) can
            easily be taller than the screen once sized by its own real
            aspect ratio. A plain View here left the confirm/retake buttons
            genuinely unreachable below the fold, with nothing to scroll -
            this must be a ScrollView so the buttons are always reachable
            regardless of the photo's proportions. */}
        <ScrollView contentContainerStyle={styles.confirmScrollContent}>
          <Text style={styles.stepIndicator}>Step 1 of 2</Text>
          <Text style={styles.title}>Is this the brand?</Text>
          <Text style={styles.body}>We found "{brand}" in this area.</Text>

          {previewUri && (
            <View style={[styles.confirmImageWrap, { aspectRatio: previewAspectRatio }]}>
              <Image source={{ uri: previewUri }} style={styles.confirmImage} resizeMode="contain" />
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
      <StepDots stageTwo={step === 'date'} />

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

          {step === 'date' && !brandDetected && rawText && (
            // Brand detection misses often enough (it depends on Google's
            // logo database, which doesn't cover every brand) that leaving
            // the user with nothing is worse than raw text they can't do
            // anything with — each line becomes a tappable candidate for
            // "this is the brand/product name" instead of just inert text
            // to read and retype. Never auto-filled: the same photo can
            // also pick up unrelated background text from other products
            // in frame, so it's the user's call which line (if any) is real.
            <View style={styles.hintBox}>
              <Text style={styles.hintLabel}>
                Couldn't tell which of these is the brand — tap one if it is:
              </Text>
              <View style={styles.hintChipRow}>
                {hintCandidates(rawText).map((candidate) => (
                  <Pressable
                    key={candidate}
                    style={[styles.hintChip, brand === candidate && styles.hintChipActive]}
                    onPress={() => setBrand((current) => (current === candidate ? null : candidate))}
                  >
                    <Text style={[styles.hintChipText, brand === candidate && styles.hintChipTextActive]}>
                      {candidate}
                    </Text>
                  </Pressable>
                ))}
              </View>
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
  frameImageWrap: {
    position: 'relative',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000',
    marginVertical: 8,
    // Explicit pixel width/height (not aspectRatio) since the frame step
    // already computed the exact contain-fit box size for this photo —
    // CropFrame's coordinates are relative to this exact box.
  },
  stepIndicator: {
    fontSize: fontSize.caption,
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
  hintChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  hintChip: {
    borderWidth: 1,
    borderColor: colors.navy,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.white,
  },
  hintChipActive: {
    backgroundColor: colors.navy,
  },
  hintChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.navy,
  },
  hintChipTextActive: {
    color: colors.white,
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
