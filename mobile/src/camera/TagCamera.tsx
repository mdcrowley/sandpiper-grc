// The camera that reads tags (spec §5.1 and §5.5, E38-05): a full-screen preview whose frames are read
// on the phone, a few times a second, by the platform's code reader (every symbology in §5.1, through
// react-native-vision-camera-barcode-scanner: Google's on-device ML Kit barcode reader) and text
// recognizer (react-native-vision-camera-ocr-plus: ML Kit's on-device text recognition, model bundled
// in the app on Android and iPhone; translation and the other scripts are switched off in app.json).
// Nothing is sent anywhere: each frame is read and released; only the plain reads (code contents,
// lines of text, boxes) reach JavaScript. A still picture is written to the app's cache, read the
// same way (./still.ts) and deleted by the screen unless the person attaches it to the record.
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import {
  Camera, useCameraDevice, useFrameOutput, usePhotoOutput, type CameraRef,
} from 'react-native-vision-camera';
import { useBarcodeScanner, type TargetBarcodeFormat } from 'react-native-vision-camera-barcode-scanner';
import { useTextRecognition } from 'react-native-vision-camera-ocr-plus';
import { scheduleOnRN } from 'react-native-worklets';
import type { FrameReads } from '../tags/read';
import { framePlain, uprightSize } from './geometry';

/** Every code type of spec §5.1 (the reader's own list; 'all-formats' would be the same set). */
export const READ_CODE_TYPES: TargetBarcodeFormat[] = [
  'qr-code', 'data-matrix', 'pdf-417', 'aztec', 'code-128', 'code-39', 'code-93',
  'ean-8', 'ean-13', 'upc-a', 'upc-e', 'itf', 'codabar',
];
/** Text recognition on every third frame it is given (the answer comes back on a later frame). One
 * object for the app's life: the hook makes a new recognizer whenever its options object changes. */
const TEXT_OPTIONS = { language: 'latin', frameSkipThreshold: 3 } as const;
/** Least time between two frames' reads reaching the screen. */
const READ_EVERY_MS = 150;

export interface TagCameraHandle {
  /** Takes a still picture into the app's cache and returns its file path (the caller deletes it). */
  takePicture(): Promise<{ path: string; width: number; height: number }>;
}

export interface TagCameraProps {
  /** Whether the camera runs (off when the screen is not shown). */
  active: boolean;
  torch: boolean;
  /** Plain reads of one frame (upright picture coordinates). */
  onReads(reads: FrameReads): void;
  onError?(error: Error): void;
  style?: StyleProp<ViewStyle>;
}

export const TagCamera = forwardRef<TagCameraHandle, TagCameraProps>(function TagCamera({ active, torch, onReads, onError, style }, ref) {
  const device = useCameraDevice('back');
  const scanner = useBarcodeScanner({ barcodeFormats: READ_CODE_TYPES });
  const { scanText } = useTextRecognition(TEXT_OPTIONS);
  const photo = usePhotoOutput({ qualityPrioritization: 'quality' });
  const camera = useRef<CameraRef>(null);
  const last = useRef(0);
  const torchUsed = useRef(false);
  if (torch) torchUsed.current = true;

  const deliver = useCallback((reads: FrameReads) => {
    const now = Date.now();
    if (now - last.current < READ_EVERY_MS) return;
    last.current = now;
    onReads(reads);
  }, [onReads]);

  const frames = useFrameOutput({
    // The text recognizer needs RGB buffers on Android; the code reader takes either.
    pixelFormat: Platform.OS === 'android' ? 'rgb' : 'native',
    dropFramesWhileBusy: true,
    onFrame(frame) {
      'worklet';
      try {
        const size = uprightSize(frame.width, frame.height, frame.orientation);
        const codes = scanner.scanCodes(frame).map((b) => ({
          format: b.format, rawValue: b.rawValue, displayValue: b.displayValue, boundingBox: b.boundingBox,
        }));
        const text = scanText(frame);
        scheduleOnRN(deliver, framePlain(size, codes, text));
      } finally {
        frame.dispose();
      }
    },
  });

  useImperativeHandle(ref, () => ({
    async takePicture() {
      const file = await photo.capturePhotoToFile({ flashMode: 'off', enableShutterSound: false }, {});
      return { path: file.filePath, width: file.width, height: file.height };
    },
  }), [photo]);

  if (!device) return null;
  return (
    <Camera
      ref={camera}
      style={style}
      device={device}
      isActive={active}
      // Only once the torch has been used: setting it while the camera is not running yet fails.
      torchMode={torch && device.hasTorch ? 'on' : torchUsed.current ? 'off' : undefined}
      outputs={[frames, photo]}
      resizeMode="cover"
      enableNativeTapToFocusGesture
      enableNativeZoomGesture
      onError={(e) => {
        // The torch cannot change while the camera is stopping or starting; it follows on the next change.
        if (/torch|Camera is not active/i.test(e.message)) return;
        onError?.(new Error(e.message.split('\n')[0]));
      }}
    />
  );
});
