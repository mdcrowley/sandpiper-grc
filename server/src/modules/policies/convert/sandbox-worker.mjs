// The work done inside the document sandbox (E43-06, E43-08): converting a Word file to Markdown and
// stamping a controlled-copy block on a PDF. It runs in a worker thread with its own heap limit, inside
// a separate process that the server kills when it takes too long (sandbox.ts, sandbox-reader.mjs), so
// a hostile file can never take the server down. Plain JavaScript, so the same file runs under the
// development runner, the tests and the container's Node.
//
// Nothing a file contains is ever run: Word macros are never looked at (and .docm is refused at
// upload), no outside program is started, nothing is fetched (mammoth reads only the parts inside the
// zip; external images are left out), and a zip whose parts would unpack beyond the limit is refused
// before anything is unpacked.
//
// Libraries: mammoth (BSD-2-Clause), turndown and turndown-plugin-gfm (MIT), fflate (MIT), pdf-lib (MIT),
// pdfkit (MIT).
import { parentPort, workerData } from 'node:worker_threads';

const { task, payload } = workerData;

// ---------------------------------------------------------------- Word to Markdown

/** Mammoth style map: Word's built-in styles to HTML (its own defaults cover headings and lists). */
const STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => h2:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
  "r[style-name='Strong'] => strong",
  "r[style-name='Emphasis'] => em",
  "p[style-name='List Paragraph'] => ul > li:fresh",
];

const MAX_IMAGES = 300;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** What the zip holds, from its directory, before anything is unpacked. */
async function inspectZip(buf, maxUnpacked) {
  const { unzipSync } = await import('fflate');
  let total = 0;
  const names = [];
  // The filter sees each entry's declared size; nothing is inflated while the filter says no.
  unzipSync(buf, { filter: (f) => { total += f.originalSize; names.push(f.name); return false; } });
  if (total > maxUnpacked) throw Object.assign(new Error(`the file would unpack to more than ${Math.round(maxUnpacked / 1024 / 1024)} MB (a zip bomb, or too large)`), { code: 'too_large' });
  if (!names.includes('word/document.xml')) throw Object.assign(new Error('this is not a Word document (no word/document.xml)'), { code: 'not_word' });
  const wanted = (n) => n === 'word/document.xml' || n === 'word/comments.xml' || /^word\/(header|footer)\d*\.xml$/.test(n);
  const parts = unzipSync(buf, { filter: (f) => wanted(f.name) });
  const text = (n) => (parts[n] ? new TextDecoder('utf-8').decode(parts[n]) : '');
  return { names, text, headerFooter: Object.keys(parts).filter((n) => /header|footer/.test(n)).map(text) };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (s) => s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
  }
  return ENTITIES[e.toLowerCase()] ?? m;
});
const xmlText = (xml) => unescapeXml(xml.replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, ' ').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').trim();

const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december';
function isoDate(s) {
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; // US order, month first
  m = new RegExp(`^(${MONTHS})\\.? (\\d{1,2}),? (\\d{4})$`, 'i').exec(t);
  if (m) return `${m[3]}-${String(MONTHS.split('|').indexOf(m[1].toLowerCase()) + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

/** Hints in headers and footers: a revision label, an effective date, a document number. */
function suggestions(texts) {
  const all = texts.join('\n');
  const out = {};
  const rev = /\b(?:Revision|Rev\.?|Version|Ver\.?)\s*(?:No\.?|Number|#)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9.\-]{0,11})\b/i.exec(all);
  if (rev && /\d|^[A-Z]$/i.test(rev[1])) out.version_label = rev[0].trim().replace(/\s*[:\-]\s*/, ' ');
  const eff = new RegExp(`\\bEffective(?:\\s+Date)?\\s*[:\\-]?\\s*(\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}/\\d{1,2}/\\d{4}|(?:${MONTHS})\\.? \\d{1,2},? \\d{4})`, 'i').exec(all);
  if (eff) {
    const d = isoDate(eff[1]);
    if (d) out.effective_on = d;
  }
  const num = /\b([A-Z]{2,5}-(?:[A-Z0-9]{1,8}-)?\d{2,5})\b/.exec(all);
  if (num) out.doc_number = num[1];
  return out;
}

/** Makes the first row of every table a heading row, so the GFM plugin writes it as a Markdown table. */
function headingRows(html) {
  return html.replace(/<table>(\s*)<tr>([\s\S]*?)<\/tr>/g, (_m, sp, row) => `<table>${sp}<thead><tr>${row.replace(/<td(\s|>)/g, '<th$1').replace(/<\/td>/g, '</th>')}</tr></thead>`);
}

async function docx(buf) {
  const zip = await inspectZip(buf, payload.maxUnpacked);
  const documentXml = zip.text('word/document.xml');
  const report = {
    tracked_changes: /<w:(ins|del|moveFrom|moveTo)\b/.test(documentXml),
    comments: (zip.text('word/comments.xml').match(/<w:comment\b/g) ?? []).length,
    dropped: [],
    warnings: [],
    suggested: suggestions(zip.headerFooter.map(xmlText)),
  };
  const drops = [
    [/<w:txbxContent\b/, 'text boxes'],
    [/drawingml\/2006\/diagram/, 'SmartArt diagrams'],
    [/drawingml\/2006\/chart/, 'charts'],
    [/<w:object\b|<o:OLEObject\b/, 'embedded objects'],
    [/<m:oMath\b/, 'equations'],
  ];
  for (const [re, what] of drops) if (re.test(documentXml)) report.dropped.push(what);
  if (zip.headerFooter.some((t) => t.trim())) report.dropped.push('headers and footers');
  if (report.comments) report.dropped.push('comments');
  if (zip.names.some((n) => /vbaProject\.bin$/i.test(n))) report.warnings.push('The file holds macros; they were ignored.');

  const mammoth = (await import('mammoth')).default;
  const images = [];
  let skippedImages = 0;
  const result = await mammoth.convertToHtml({ buffer: buf }, {
    styleMap: STYLE_MAP,
    includeDefaultStyleMap: true,
    ignoreEmptyParagraphs: true,
    externalFileAccess: false,
    convertImage: mammoth.images.imgElement(async (image) => {
      if (images.length >= MAX_IMAGES) { skippedImages += 1; return { src: '', alt: image.altText ?? '' }; }
      const bytes = await image.read();
      if (bytes.length > MAX_IMAGE_BYTES) { skippedImages += 1; return { src: '', alt: image.altText ?? '' }; }
      images.push({ n: images.length + 1, contentType: image.contentType, alt: (image.altText ?? '').trim(), bytes: new Uint8Array(bytes) });
      return { src: `attachment:pending-${images.length}`, alt: (image.altText ?? '').trim() };
    }),
  });
  if (skippedImages) report.warnings.push(`${skippedImages} image${skippedImages === 1 ? ' was' : 's were'} too large or too many and left out.`);
  const messages = [...new Set(result.messages.filter((m) => m.type === 'warning').map((m) => String(m.message).slice(0, 200)))];
  const unknownStyles = messages.filter((m) => /Unrecognised (paragraph|run) style/i.test(m)).length;
  if (unknownStyles) report.warnings.push(`${unknownStyles} Word style${unknownStyles === 1 ? ' was' : 's were'} not recognized; their text was kept as plain paragraphs.`);
  for (const m of messages.filter((x) => !/Unrecognised (paragraph|run) style/i.test(x)).slice(0, 10)) report.warnings.push(m);

  const TurndownService = (await import('turndown')).default;
  const { gfm } = await import('turndown-plugin-gfm');
  const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*', strongDelimiter: '**' });
  td.use(gfm);
  // A table cell keeps to one line: its paragraphs are joined, and pipes escaped.
  td.addRule('flatCell', {
    filter: ['th', 'td'],
    replacement(content, node) {
      const index = Array.prototype.indexOf.call(node.parentNode.childNodes, node);
      const flat = content.replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim();
      return `${index === 0 ? '| ' : ' '}${flat} |`;
    },
  });
  // List items with one space after the marker ("- item", "1. item").
  td.addRule('listItem', {
    filter: 'li',
    replacement(content, node) {
      const parent = node.parentNode;
      let prefix = '- ';
      if (parent.nodeName === 'OL') {
        const start = parent.getAttribute('start');
        const index = Array.prototype.indexOf.call(parent.children, node);
        prefix = `${start ? Number(start) + index : index + 1}. `;
      }
      const body = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n/gm, `\n${' '.repeat(prefix.length)}`);
      return prefix + body + (node.nextSibling && !/\n$/.test(body) ? '\n' : '');
    },
  });
  // Images without an address (left out above) disappear; the rest keep their alternative text.
  td.addRule('image', {
    filter: 'img',
    replacement(_content, node) {
      const src = node.getAttribute('src') || '';
      if (!src) return '';
      const alt = (node.getAttribute('alt') || '').replace(/[\[\]\n]/g, ' ').trim();
      return `![${alt}](${src})`;
    },
  });
  // Footnote and endnote anchors mammoth writes as links to the notes list are kept as plain links.
  const markdown = td.turndown(headingRows(result.value)).replace(/\n{3,}/g, '\n\n').trim();
  return { markdown, images, report };
}

// ---------------------------------------------------------------- PDF stamping

async function stamp(buf) {
  const { PDFDocument } = await import('pdf-lib');
  let doc;
  try {
    doc = await PDFDocument.load(buf, { updateMetadata: false });
  } catch (err) {
    if (/encrypt/i.test(String(err && err.message))) throw Object.assign(new Error('the PDF is protected by a password or encrypted'), { code: 'encrypted' });
    throw err;
  }
  const pages = doc.getPages();
  if (pages.length > payload.maxPages) throw Object.assign(new Error(`the PDF has more than ${payload.maxPages} pages`), { code: 'too_large' });
  const PDFKit = (await import('pdfkit')).default;
  const overlay = new PDFKit({ autoFirstPage: false, compress: true, info: { Producer: 'Sandpiper GRC' } });
  overlay.registerFont('Body', payload.fontRegular);
  overlay.registerFont('Bold', payload.fontBold);
  const chunks = [];
  overlay.on('data', (c) => chunks.push(c));
  const finished = new Promise((resolve, reject) => { overlay.on('end', resolve); overlay.on('error', reject); });
  const o = payload.options;
  const total = pages.length;
  for (let i = 0; i < total; i++) {
    const { width, height } = pages[i].getSize();
    overlay.addPage({ size: [width, height], margin: 0 });
    const size = Math.max(6, Math.min(8, width / 80));
    const band = (text, y, font, align) => {
      if (!text) return;
      overlay.font(font).fontSize(size);
      const w = Math.min(width - 36, overlay.widthOfString(text) + 6);
      const x = align === 'right' ? width - 18 - w : 18;
      overlay.save().rect(x - 3, y - 2, w + 6, size + 5).fillOpacity(0.85).fill('#ffffff').restore();
      overlay.fillColor('#222222').fillOpacity(1).text(text, x, y, { width: w, height: size + 3, lineBreak: false, ellipsis: true, align: align === 'right' ? 'right' : 'left' });
    };
    band(o.header, 8, 'Body', 'left');
    if (o.restricted) band('Restricted distribution', 8, 'Bold', 'right');
    band(String(o.footer || '').replace(/\{page\}/g, String(i + 1)).replace(/\{pages\}/g, String(total)), height - size - 10, 'Body', 'left');
    if (o.watermark) {
      const big = Math.min(width, height) / 7;
      overlay.save().translate(width / 2, height / 2).rotate(-45).font('Bold').fontSize(big).fillOpacity(0.18).fillColor('#c00000');
      const ww = overlay.widthOfString(o.watermark);
      overlay.text(o.watermark, -ww / 2, -big / 2, { lineBreak: false });
      overlay.restore();
    }
  }
  overlay.end();
  await finished;
  const overlayBytes = Buffer.concat(chunks);
  const embedded = await doc.embedPdf(overlayBytes, pages.map((_, i) => i));
  // The block is drawn in the page's own coordinates (a page shown rotated shows it rotated too).
  pages.forEach((page, i) => {
    const box = page.getMediaBox();
    const { width, height } = page.getSize();
    page.drawPage(embedded[i], { x: box.x, y: box.y, width, height });
  });
  return { bytes: new Uint8Array(await doc.save({ useObjectStreams: false })), pages: total };
}

// ---------------------------------------------------------------- run

async function run() {
  const buf = Buffer.from(payload.bytes.buffer, payload.bytes.byteOffset, payload.bytes.byteLength);
  if (task === 'docx') return docx(buf);
  if (task === 'stamp') return stamp(buf);
  throw new Error(`unknown task ${task}`);
}

run().then(
  (result) => parentPort.postMessage({ ok: true, result }),
  (err) => parentPort.postMessage({ ok: false, error: String((err && err.message) || err).slice(0, 300), code: (err && err.code) || null }),
);
