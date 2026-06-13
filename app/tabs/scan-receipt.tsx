import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { YStack, XStack, Button, Paragraph, Input, Text, Spinner } from 'tamagui';
import { ChevronLeft, AlertTriangle, Camera as CameraIcon, QrCode, Cpu } from '@tamagui/lucide-icons';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import {
  useReceiptSessionStore,
  CapturedReceiptImage,
  ScanMode,
} from '@/features/receipt/model/receipt-session.store';
import { useAppStore } from '@/shared/lib/stores/app-store';
import { DEFAULT_LANGUAGE } from '@/shared/config/languages';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getDefaultSessionName = () => {
  const now = new Date();
  const pad = (v: number) => v.toString().padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
};

const MODES: { key: ScanMode; label: string; icon: React.ReactNode }[] = [
  { key: 'gemini', label: 'Gemini AI', icon: <CameraIcon size={13} color="white" /> },
  { key: 'qr',     label: 'QR Link',   icon: <QrCode size={13} color="white" /> },
  { key: 'local',  label: 'Local AI',  icon: <Cpu size={13} color="white" /> },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function ScanReceiptScreen() {
  const [perm, requestPerm] = useCameraPermissions();
  const isFocused = useIsFocused();
  const router = useRouter();
  const cameraRef = useRef<CameraView | null>(null);

  const parsing          = useReceiptSessionStore((s) => s.parsing);
  const parseError       = useReceiptSessionStore((s) => s.parseError);
  const parseReceipt     = useReceiptSessionStore((s) => s.parseReceipt);
  const parseReceiptByUrl = useReceiptSessionStore((s) => s.parseReceiptByUrl);
  const parseReceiptLocal = useReceiptSessionStore((s) => s.parseReceiptLocal);
  const setCapture       = useReceiptSessionStore((s) => s.setCapture);
  const clearCapture     = useReceiptSessionStore((s) => s.clearCapture);
  const storedCapture    = useReceiptSessionStore((s) => s.capture);
  const setSessionNameStore = useReceiptSessionStore((s) => s.setSessionName);
  const storedSessionName   = useReceiptSessionStore((s) => s.session?.sessionName);
  const appLanguage = useAppStore((s) => s.language);

  const [mode, setMode] = useState<ScanMode>('gemini');
  const [qrUrl, setQrUrl] = useState('');
  const [sessionName, setSessionName] = useState(() => storedSessionName || getDefaultSessionName());
  const [isAutoName, setIsAutoName] = useState(() => !storedSessionName);
  const [localError, setLocalError] = useState<string | null>(null);

  const language = appLanguage || DEFAULT_LANGUAGE;
  const needsCamera = mode === 'gemini' || mode === 'local';

  // ── Permissions ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isFocused && needsCamera && !perm?.granted) requestPerm();
  }, [isFocused, needsCamera, perm?.granted, requestPerm]);

  // ── Session name sync ────────────────────────────────────────────────────────
  useEffect(() => {
    if (storedSessionName) {
      setIsAutoName(false);
      setSessionName((prev) => prev === storedSessionName ? prev : storedSessionName);
    } else {
      setIsAutoName(true);
    }
  }, [storedSessionName]);

  useFocusEffect(
    useCallback(() => {
      if (storedSessionName || !isAutoName) return;
      const fresh = getDefaultSessionName();
      setSessionName((prev) => prev === fresh ? prev : fresh);
    }, [storedSessionName, isAutoName])
  );

  useEffect(() => () => clearCapture(), [clearCapture]);

  // ── Capture helper (shared by Gemini + Local AI) ─────────────────────────────
  const captureImage = async (): Promise<CapturedReceiptImage> => {
    if (!cameraRef.current) throw new Error('Camera not ready');

    const picture = await cameraRef.current.takePictureAsync({
      quality: 0.7,
      base64: false,
      skipProcessing: true,
    });
    if (!picture?.uri) throw new Error('Could not capture photo. Please try again.');

    const targetWidth = picture.width ? Math.min(picture.width, 1280) : undefined;
    const manipResult = await manipulateAsync(
      picture.uri,
      targetWidth ? [{ resize: { width: targetWidth } }] : [],
      { compress: 0.45, format: SaveFormat.JPEG, base64: true }
    );
    if (!manipResult?.base64) throw new Error('Failed to prepare photo for upload.');

    if (__DEV__) {
      const kb = (manipResult.base64.length * 3) / 4 / 1024;
      console.log(`[ReceiptScan] ~${kb.toFixed(1)}KB ${manipResult.width}x${manipResult.height}`);
    }

    return {
      uri: manipResult.uri ?? picture.uri,
      base64: manipResult.base64,
      mimeType: 'image/jpeg',
      width: manipResult.width ?? picture.width,
      height: manipResult.height ?? picture.height,
    };
  };

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleGemini = useCallback(async () => {
    if (parsing) return;
    try {
      setLocalError(null);
      const preparedName = sessionName.trim() || getDefaultSessionName();
      const capture = await captureImage();
      setSessionNameStore(preparedName);
      setCapture(capture);
      await parseReceipt({
        sessionName: preparedName,
        language,
        image: { data: capture.base64, mimeType: capture.mimeType },
      });
      router.push('/tabs/sessions/participants');
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Something went wrong');
    }
  }, [parsing, sessionName, language, parseReceipt, setCapture, setSessionNameStore, router]);

  const handleQr = useCallback(async () => {
    if (parsing) return;
    const trimmed = qrUrl.trim();
    if (!trimmed) {
      setLocalError('Paste the QR link first');
      return;
    }
    if (!trimmed.startsWith('https://ofd.soliq.uz/check')) {
      setLocalError('Invalid link. Must start with https://ofd.soliq.uz/check');
      return;
    }
    try {
      setLocalError(null);
      const preparedName = sessionName.trim() || getDefaultSessionName();
      setSessionNameStore(preparedName);
      await parseReceiptByUrl({ url: trimmed, sessionName: preparedName });
      router.push('/tabs/sessions/participants');
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Failed to fetch receipt');
    }
  }, [parsing, qrUrl, sessionName, parseReceiptByUrl, setSessionNameStore, router]);

  const handleLocal = useCallback(async () => {
    if (parsing) return;
    try {
      setLocalError(null);
      const preparedName = sessionName.trim() || getDefaultSessionName();
      const capture = await captureImage();
      setSessionNameStore(preparedName);
      setCapture(capture);
      await parseReceiptLocal({
        sessionName: preparedName,
        language,
        image: { data: capture.base64, mimeType: capture.mimeType },
      });
      router.push('/tabs/sessions/participants');
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Local AI error');
    }
  }, [parsing, sessionName, language, parseReceiptLocal, setCapture, setSessionNameStore, router]);

  const handleAction = mode === 'gemini' ? handleGemini : mode === 'qr' ? handleQr : handleLocal;

  const handleModeChange = (next: ScanMode) => {
    setMode(next);
    setLocalError(null);
  };

  const handleSessionNameChange = useCallback((value: string) => {
    setIsAutoName(false);
    setSessionName(value);
  }, []);

  const goBack = useCallback(() => router.back(), [router]);
  const useMock = useCallback(() => {
    router.push({ pathname: '/tabs/sessions/participants', params: { receiptId: 'mock-001' } } as never);
  }, [router]);

  const disableAction = parsing || (needsCamera && !perm?.granted);
  const errorMessage = localError || parseError;

  const actionLabel = () => {
    if (parsing) return 'Processing...';
    if (mode === 'gemini') return 'Scan receipt';
    if (mode === 'qr') return 'Fetch receipt';
    return 'Scan (Local AI)';
  };

  const actionIcon = () => {
    if (parsing) return undefined;
    if (mode === 'gemini') return <CameraIcon size={18} color="white" />;
    if (mode === 'qr') return <QrCode size={18} color="white" />;
    return <Cpu size={18} color="white" />;
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <View style={S.root}>

      {/* Header */}
      <View style={S.headerAbs}>
        <XStack ai="center" jc="space-between" px="$3" py="$2">
          <Button size="$2" h={28} chromeless onPress={goBack}
            icon={<ChevronLeft size={18} color="white" />} color="white">
            Back
          </Button>
          <Paragraph fow="700" fos="$6" col="white">Scan receipt</Paragraph>
          <YStack w={54} />
        </XStack>

        {/* Mode switcher */}
        <XStack px="$3" pb="$2" gap="$2">
          {MODES.map(({ key, label, icon }) => (
            <Button
              key={key}
              size="$2"
              flex={1}
              borderRadius="$3"
              onPress={() => handleModeChange(key)}
              backgroundColor={mode === key ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.08)'}
              borderWidth={mode === key ? 1 : 0}
              borderColor="rgba(255,255,255,0.4)"
              color="white"
              icon={icon}
            >
              {label}
            </Button>
          ))}
        </XStack>
      </View>

      {/* Camera / placeholder */}
      <View style={S.cameraWrap}>
        {needsCamera ? (
          isFocused && perm?.granted ? (
            <CameraView ref={cameraRef} style={S.camera} facing="back" />
          ) : (
            <YStack f={1} ai="center" jc="center">
              {!perm
                ? <ActivityIndicator color="white" />
                : <Paragraph col="$gray1">Allow camera access</Paragraph>
              }
            </YStack>
          )
        ) : (
          // QR mode placeholder
          <YStack f={1} ai="center" jc="center" gap="$3">
            <QrCode size={72} color="rgba(255,255,255,0.15)" />
            <Paragraph col="rgba(255,255,255,0.35)" ta="center" px="$8" fos={13}>
              Open the receipt in browser, copy the link from the address bar and paste it below
            </Paragraph>
          </YStack>
        )}

        {parsing && (
          <View style={S.overlay}>
            <Spinner size="large" color="white" />
            <Paragraph mt="$2" col="white">
              {mode === 'qr' ? 'Fetching receipt...' : mode === 'local' ? 'Running local AI...' : 'Uploading receipt...'}
            </Paragraph>
          </View>
        )}
      </View>

      {/* Bottom panel */}
      <View style={S.actions}>
        <YStack gap="$3">

          {/* Session name */}
          <YStack gap={6}>
            <Paragraph color="$gray1" fontSize={12}>Session name</Paragraph>
            <Input
              value={sessionName}
              onChangeText={handleSessionNameChange}
              placeholder="e.g. Cafe on October"
              height={41}
              borderRadius={10}
              px={16}
              backgroundColor="rgba(255,255,255,0.1)"
              color="white"
              borderWidth={1}
              borderColor="rgba(255,255,255,0.25)"
            />
          </YStack>

          {/* QR URL input */}
          {mode === 'qr' && (
            <YStack gap={6}>
              <Paragraph color="$gray1" fontSize={12}>Receipt QR link</Paragraph>
              <Input
                value={qrUrl}
                onChangeText={setQrUrl}
                placeholder="https://ofd.soliq.uz/check?t=..."
                height={41}
                borderRadius={10}
                px={16}
                backgroundColor="rgba(255,255,255,0.1)"
                color="white"
                borderWidth={1}
                borderColor="rgba(255,255,255,0.25)"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
            </YStack>
          )}

          {/* Language hint for camera modes */}
          {needsCamera && (
            <Paragraph color="$gray1" fontSize={12}>
              Language: <Text fontWeight="700" color="white">{language}</Text>
            </Paragraph>
          )}

          {/* Local AI hint */}
          {mode === 'local' && (
            <XStack ai="center" gap="$2" bg="rgba(255,200,0,0.1)" px="$2" py="$2" borderRadius={8}>
              <Cpu size={14} color="rgba(255,200,0,0.8)" />
              <Paragraph color="rgba(255,200,0,0.8)" fontSize={11} flexShrink={1}>
                Requires FastAPI service running on port 8001
              </Paragraph>
            </XStack>
          )}

          {/* Last captured preview */}
          {storedCapture?.uri && needsCamera && (
            <XStack ai="center" gap="$2">
              <Image source={{ uri: storedCapture.uri }} style={S.preview} resizeMode="cover" />
              <Paragraph color="$gray1" fontSize={12} flexShrink={1}>
                Last photo stored; capturing again will overwrite it.
              </Paragraph>
            </XStack>
          )}

          {/* Error */}
          {errorMessage && (
            <XStack ai="center" gap="$2" bg="rgba(255,99,71,0.18)" px="$2" py="$2" borderRadius={8}>
              <AlertTriangle size={16} color="#FF6B6B" />
              <Paragraph color="#FF6B6B" flexShrink={1}>{errorMessage}</Paragraph>
            </XStack>
          )}

          {/* Actions */}
          <XStack ai="center" jc="space-between" gap="$3">
            <Button size="$3" borderRadius="$3" theme="gray" onPress={goBack}
              disabled={parsing} opacity={parsing ? 0.6 : 1}>
              Cancel
            </Button>
            <Button
              size="$3"
              borderRadius="$3"
              theme="active"
              onPress={handleAction}
              disabled={disableAction}
              icon={actionIcon()}
            >
              {actionLabel()}
            </Button>
          </XStack>

          <Button size="$2" borderRadius="$3" theme="gray" variant="outlined"
            onPress={useMock} disabled={parsing}>
            Use mock receipt
          </Button>

        </YStack>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  headerAbs: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
    paddingTop: 8, backgroundColor: 'rgba(0,0,0,0.25)',
  },
  cameraWrap: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    position: 'absolute',
    bottom: 24, left: 16, right: 16,
    backgroundColor: 'rgba(0,0,0,0.45)',
    padding: 16,
    borderRadius: 16,
  },
  preview: {
    width: 56, height: 56, borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)',
  },
});
