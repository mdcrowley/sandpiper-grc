// Reads the text of one attached file (E41-16), inside a worker thread that the caller ends when it
// takes too long and that has its own memory limit (text.ts). Plain JavaScript, so the same file
// runs under the development runner, the tests and the container's Node.
//
// What it reads, and how, without running anything the file contains:
//   - PDF: pdf.js (`pdfjs-dist`, Apache-2.0) in its text-only mode: no scripts (it has no eval), no fonts
//     loaded, no forms (XFA) and no network. Only the text of each page is kept.
//   - Word (.docx): the document's XML parts, read with fflate (MIT) from the zip; macros are never
//     looked at (.docm is refused at upload anyway), and parts that would unpack beyond the limit
//     are skipped (a zip bomb is never unpacked).
//   - Plain text (.txt, .md, .log, .csv): decoded as UTF-8 or UTF-16 (by its byte-order mark).
//   - Scanned PDFs (E43-15): a PDF with no text layer is reported as `scanned`; read again with `ocr`,
//     the pictures on its first pages are taken from the file by pdf.js (decoded in JavaScript, no
//     canvas) and read with tesseract.js (Apache-2.0, WebAssembly) using the language data bundled
//     with the application (`ocr.langPath`): nothing is downloaded and no outside request is made.
// No outside program is ever started.
import { parentPort, workerData } from 'node:worker_threads';

const { bytes, extension, maxChars, maxPages, maxUnpacked, ocr } = workerData;
/** A PDF whose text layer has fewer letters than this is treated as scanned. */
const SCANNED_BELOW = 20;
/** Pictures larger than this (pixels) are not read: a page scanned at 300 dpi is about 8.4 million. */
const OCR_MAX_PIXELS = 40_000_000;
/** Pictures smaller than this on either side are not text worth reading (logos, rules). */
const OCR_MIN_SIDE = 100;

function clip(text) {
  const clean = String(text ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return clean.length > maxChars ? clean.slice(0, maxChars) : clean;
}

function decodeText(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  return new TextDecoder('utf-8').decode(buf);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (s) => s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
  }
  return ENTITIES[e.toLowerCase()] ?? m;
});

/** The words of one WordprocessingML part: runs of text, tabs and breaks, a new line per paragraph. */
function wordXmlText(xml) {
  // Field codes (w:instrText) and everything else that is not a run of text are left out.
  const token = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/>|<\/w:p>/g;
  let out = '';
  for (const m of xml.matchAll(token)) {
    if (m[1] !== undefined) out += unescapeXml(m[1]);
    else if (m[2] === 'tab') out += '\t';
    else out += '\n';
  }
  return out;
}

/** A reader library that is not installed: the file is left for a later run, not marked as failed. */
async function load(name) {
  try {
    return await import(name);
  } catch {
    const err = new Error(`the reader ${name} is not installed`);
    err.unavailable = true;
    throw err;
  }
}

async function docx(buf) {
  const { unzipSync } = await load('fflate');
  const wanted = (name) => name === 'word/document.xml' || /^word\/(footnotes|endnotes|comments|header\d*|footer\d*)\.xml$/.test(name);
  let budget = maxUnpacked;
  const files = unzipSync(buf, {
    filter: (f) => {
      if (!wanted(f.name) || f.originalSize > budget) return false;
      budget -= f.originalSize;
      return true;
    },
  });
  if (!files['word/document.xml']) throw new Error('not a Word document (no word/document.xml), or too large to unpack');
  const order = Object.keys(files).sort((a, b) => (a === 'word/document.xml' ? -1 : b === 'word/document.xml' ? 1 : a.localeCompare(b)));
  return order.map((name) => wordXmlText(new TextDecoder('utf-8').decode(files[name]))).join('\n');
}

async function pdf(buf) {
  const { getDocument } = await load('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: new Uint8Array(buf), disableFontFace: true, useSystemFonts: false, enableXfa: false,
    stopAtErrors: false, verbosity: 0, disableAutoFetch: true, disableStream: true,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    if (err && err.name === 'PasswordException') throw new Error('the PDF is protected by a password');
    throw err;
  }
  const out = [];
  let length = 0;
  try {
    const pages = Math.min(doc.numPages, maxPages);
    for (let i = 1; i <= pages && length < maxChars; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent({ disableNormalization: false });
      let line = '';
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        line += item.str + (item.hasEOL ? '\n' : '');
      }
      out.push(line);
      length += line.length;
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return out.join('\n');
}

/** A decoded pdf.js picture as an 8-bit grey PNM (P5) file, which the OCR engine reads directly. */
function toPgm(img) {
  const { width: w, height: h, kind, data } = img;
  const gray = Buffer.alloc(w * h);
  if (kind === 2 || kind === 3) {
    const bpp = kind === 2 ? 3 : 4;
    for (let i = 0, j = 0; i < w * h; i++, j += bpp) gray[i] = (data[j] * 299 + data[j + 1] * 587 + data[j + 2] * 114) / 1000;
  } else {
    // One bit per pixel, rows padded to whole bytes; a set bit is white (pdf.js GRAYSCALE_1BPP).
    const row = (w + 7) >> 3;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) gray[y * w + x] = (data[y * row + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
  }
  return Buffer.concat([Buffer.from(`P5\n${w} ${h}\n255\n`), gray]);
}

/** The text of a scanned PDF: its pictures, page by page, read by the OCR engine. */
async function ocrPdf(buf) {
  const { getDocument, OPS } = await load('pdfjs-dist/legacy/build/pdf.mjs');
  const { createWorker } = await load('tesseract.js');
  const task = getDocument({
    data: new Uint8Array(buf), disableFontFace: true, useSystemFonts: false, enableXfa: false,
    stopAtErrors: false, verbosity: 0, disableAutoFetch: true, disableStream: true,
    isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
  });
  const doc = await task.promise;
  // Local language data only; nothing cached to disk, nothing fetched.
  const engine = await createWorker(ocr.langs, 1, { langPath: ocr.langPath, cacheMethod: 'none', gzip: ocr.gzip !== false });
  const out = [];
  let length = 0;
  let pictures = 0;
  try {
    const pages = Math.min(doc.numPages, ocr.maxPages);
    for (let i = 1; i <= pages && length < maxChars; i++) {
      const page = await doc.getPage(i);
      const ops = await page.getOperatorList();
      for (let k = 0; k < ops.fnArray.length && length < maxChars; k++) {
        if (ops.fnArray[k] !== OPS.paintImageXObject) continue;
        const name = ops.argsArray[k][0];
        const img = await new Promise((resolve) => (page.objs.has(name) ? resolve(page.objs.get(name)) : page.objs.get(name, resolve)));
        if (!img || !img.data || !img.width || !img.height) continue;
        if (img.width * img.height > OCR_MAX_PIXELS || img.width < OCR_MIN_SIDE || img.height < OCR_MIN_SIDE / 4) continue;
        pictures += 1;
        const r = await engine.recognize(toPgm(img));
        const text = String(r?.data?.text ?? '');
        out.push(text);
        length += text.length;
      }
      page.cleanup();
    }
  } finally {
    await engine.terminate();
    await task.destroy();
  }
  return { text: out.join('\n'), pictures };
}

async function run() {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (extension === 'pdf' && ocr) return ocrPdf(buf);
  if (extension === 'pdf') return pdf(buf);
  if (extension === 'docx') return docx(buf);
  return decodeText(buf);
}

run().then(
  (out) => {
    if (out && typeof out === 'object') return parentPort.postMessage({ ok: true, text: clip(out.text), ocr: true, pictures: out.pictures });
    const text = clip(out);
    // A PDF with (almost) no text layer is a scan: the caller may read it again with OCR.
    const scanned = extension === 'pdf' && text.replace(/\s+/g, '').length < SCANNED_BELOW;
    return parentPort.postMessage({ ok: true, text, ...(scanned ? { scanned: true } : {}) });
  },
  (err) => parentPort.postMessage({ ok: false, error: String((err && err.message) || err).slice(0, 300), unavailable: Boolean(err && err.unavailable) }),
);
