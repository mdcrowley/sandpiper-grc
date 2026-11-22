// Where something read in a camera frame appears on screen. The readers give boxes in the upright
// picture's pixels (they are told the frame's orientation); the preview fills the screen, cropping
// the picture's long side ("cover"). Pure, so it is tested without a camera.
import type { Box, CodeRead, FrameReads, TextLine } from '../tags/read';
import type { CodeType } from '../tags/read';

export interface Size { width: number; height: number }

/** The upright size of a frame whose buffer is `width` by `height`, turned by `orientation`. */
export function uprightSize(width: number, height: number, orientation: 'up' | 'right' | 'down' | 'left'): Size {
  'worklet';
  return orientation === 'right' || orientation === 'left' ? { width: height, height: width } : { width, height };
}

/** Maps a box in the upright picture to the preview view (cover scaling, centered). */
export function toView(box: Box, picture: Size, view: Size): Box {
  if (!picture.width || !picture.height) return { x: 0, y: 0, width: 0, height: 0 };
  const scale = Math.max(view.width / picture.width, view.height / picture.height);
  const dx = (view.width - picture.width * scale) / 2;
  const dy = (view.height - picture.height * scale) / 2;
  return { x: box.x * scale + dx, y: box.y * scale + dy, width: box.width * scale, height: box.height * scale };
}

// ---------- the readers' output as plain data ----------

/** A decoded code as the code reader gives it (only the fields used). */
export interface NativeBarcode {
  format: string;
  rawValue?: string;
  displayValue?: string;
  boundingBox: { left: number; right: number; top: number; bottom: number };
}
/** Text as the text recognizer gives it (only the fields used). */
export interface NativeText {
  /**
   * The recognizer's `x` and `y` are not the top-left corner on Android (react-native-vision-camera-ocr-plus
   * 2.1 carries over an older library's transform), so boxes are built from the center and the size.
   */
  blocks: { lines: { lineText: string; lineFrame: { x: number; y: number; width: number; height: number; boundingCenterX?: number; boundingCenterY?: number } }[] }[];
}

/** Plain reads from the readers' answers for one frame or picture. Runs in the frame processor (a worklet). */
export function framePlain(size: Size, barcodes: NativeBarcode[], text: NativeText | null, still = false): FrameReads {
  'worklet';
  // Listed here (not imported) because a worklet captures only plain values.
  const known = ['qr-code', 'data-matrix', 'pdf-417', 'aztec', 'code-128', 'code-39', 'code-93', 'ean-8', 'ean-13', 'upc-a', 'upc-e', 'itf', 'codabar'];
  const codes: CodeRead[] = [];
  for (const b of barcodes) {
    const content = b.rawValue ?? b.displayValue ?? '';
    if (!content) continue;
    const box = b.boundingBox;
    codes.push({
      type: (known.includes(b.format) ? b.format : 'unknown') as CodeType,
      content,
      box: { x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top },
    });
  }
  const lines: TextLine[] = [];
  for (const block of text?.blocks ?? []) {
    for (const l of block.lines) {
      if (!l.lineText) continue;
      const f = l.lineFrame;
      const x = f.boundingCenterX !== undefined ? f.boundingCenterX - f.width / 2 : f.x;
      const y = f.boundingCenterY !== undefined ? f.boundingCenterY - f.height / 2 : f.y;
      lines.push({ text: l.lineText, box: { x, y, width: f.width, height: f.height } });
    }
  }
  return { width: size.width, height: size.height, codes, lines, still };
}
