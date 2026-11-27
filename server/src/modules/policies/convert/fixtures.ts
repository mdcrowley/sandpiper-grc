// Small Word (.docx) and PDF files built in code for the tests (E43-06, E43-08, E43-11). Invented text only.
import { zipSync, strToU8 } from 'fflate';
import PDFDocument from 'pdfkit';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** A 1×1 PNG. */
export const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const run = (text: string, props = '') => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
export const para = (text: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${run(text)}</w:p>`;
export const boldPara = (before: string, bold: string, after: string) => `<w:p>${run(before)}${run(bold, '<w:b/>')}${run(after)}</w:p>`;
export const table = (rows: string[][]) => `<w:tbl>${rows.map((r) => `<w:tr>${r.map((c) => `<w:tc>${para(c)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
export const bullet = (text: string) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run(text)}</w:p>`;
export const insertion = (text: string) => `<w:p><w:ins w:id="1" w:author="Invented Editor" w:date="2024-01-02T00:00:00Z">${run(text)}</w:ins></w:p>`;
export const image = (alt: string) => `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="9525" cy="9525"/><wp:docPr id="1" name="Picture 1" descr="${esc(alt)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="image1.png" descr="${esc(alt)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg1"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
</w:styles>`;
const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

/** A .docx whose body is the given WordprocessingML paragraphs (see the helpers above). */
export function makeDocx(body: string[], opts: { image?: boolean; comment?: string; footer?: string; extra?: Record<string, Uint8Array> } = {}): Buffer {
  const rels = [
    `<Relationship Id="rIdStyles" Type="${R}/styles" Target="styles.xml"/>`,
    `<Relationship Id="rIdNum" Type="${R}/numbering" Target="numbering.xml"/>`,
    ...(opts.image ? [`<Relationship Id="rIdImg1" Type="${R}/image" Target="media/image1.png"/>`] : []),
    ...(opts.comment ? [`<Relationship Id="rIdCom" Type="${R}/comments" Target="comments.xml"/>`] : []),
    ...(opts.footer ? [`<Relationship Id="rIdFoot" Type="${R}/footer" Target="footer1.xml"/>`] : []),
  ];
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`),
    'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body.join('')}<w:sectPr>${opts.footer ? '<w:footerReference w:type="default" r:id="rIdFoot"/>' : ''}</w:sectPr></w:body></w:document>`),
    'word/styles.xml': strToU8(STYLES),
    'word/numbering.xml': strToU8(NUMBERING),
    ...(opts.image ? { 'word/media/image1.png': new Uint8Array(TINY_PNG) } : {}),
    ...(opts.comment ? { 'word/comments.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Invented Reviewer">${para(opts.comment)}</w:comment></w:comments>`) } : {}),
    ...(opts.footer ? { 'word/footer1.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="${W}">${para(opts.footer)}</w:ftr>`) } : {}),
    ...(opts.extra ?? {}),
  };
  return Buffer.from(zipSync(files));
}

const FONT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../core/export/fonts/Arimo-Regular.ttf');

/** A PDF with a text layer (one page per string), or with no text at all (a "scan"). */
export function makePdf(pages: string[], opts: { noText?: boolean } = {}): Promise<Buffer> {
  return new Promise((resolveP, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolveP(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('Body', FONT);
    for (const p of pages) {
      doc.addPage({ size: 'LETTER' });
      if (opts.noText) doc.rect(72, 72, 200, 100).fill('#777777');
      else doc.font('Body').fontSize(12).text(p, 72, 72);
    }
    doc.end();
  });
}

/** The text of every page, read with pdf.js (tests only; the server never parses a PDF in its own process). */
export async function pdfText(buf: Buffer): Promise<string> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(buf), disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    out += `${content.items.map((x) => ('str' in x ? x.str : '')).join(' ')}\n`;
  }
  await task.destroy();
  return out;
}
