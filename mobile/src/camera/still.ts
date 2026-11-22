// Reading a still picture (spec §5.5: the shutter, for glare, curved surfaces and small tags; also a
// picture chosen from the phone's library): the same on-device code reader and text recognizer as the
// live camera, run once on the file. The picture stays in the app's cache and is deleted when the
// person leaves the result, unless they attach it to the record (./photos.ts).
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { loadImage } from 'react-native-nitro-image';
import { createBarcodeScanner } from 'react-native-vision-camera-barcode-scanner';
import { PhotoRecognizer } from 'react-native-vision-camera-ocr-plus';
import type { FrameReads } from '../tags/read';
import { framePlain } from './geometry';
import { READ_CODE_TYPES } from './TagCamera';

const filePathOf = (pathOrUri: string) => pathOrUri.replace(/^file:\/\//, '');
const uriOf = (pathOrUri: string) => (pathOrUri.startsWith('file://') ? pathOrUri : `file://${pathOrUri}`);

/**
 * The picture turned upright. A camera picture is stored sideways with an orientation note (EXIF), which
 * neither reader applies, and the text recognizer cannot read sideways text; so an upright copy is read
 * (and deleted afterward).
 */
async function upright(pathOrUri: string): Promise<string> {
  const ref = await ImageManipulator.manipulate(uriOf(pathOrUri)).renderAsync();
  try {
    return (await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.95 })).uri;
  } finally {
    ref.release();
  }
}

/** Reads every code and line of text in a picture file. */
export async function readStill(original: string): Promise<FrameReads> {
  const pathOrUri = /\.jpe?g$/i.test(original) ? await upright(original) : original;
  try {
    return await readFile(pathOrUri);
  } finally {
    if (pathOrUri !== original) discardPicture(pathOrUri);
  }
}

async function readFile(pathOrUri: string): Promise<FrameReads> {
  const image = await loadImage({ filePath: filePathOf(pathOrUri) });
  const scanner = createBarcodeScanner({ barcodeFormats: READ_CODE_TYPES });
  try {
    const [barcodes, text] = await Promise.all([
      scanner.scanCodesInImageAsync(image),
      PhotoRecognizer({ uri: uriOf(pathOrUri) }),
    ]);
    return framePlain(
      { width: image.width, height: image.height },
      barcodes.map((b) => ({ format: b.format, rawValue: b.rawValue, displayValue: b.displayValue, boundingBox: b.boundingBox })),
      text,
      true,
    );
  } finally {
    image.dispose();
    scanner.dispose();
  }
}

/** Deletes a picture the camera took (never one from the person's library). */
export function discardPicture(pathOrUri: string | null | undefined): void {
  if (!pathOrUri) return;
  try {
    const f = new File(uriOf(pathOrUri));
    if (f.exists) f.delete();
  } catch {
    // Already gone.
  }
}
