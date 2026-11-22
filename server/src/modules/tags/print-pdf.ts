// Printed tags as a PDF (E37-08), made with PDFKit, the engine every server PDF uses (core/export).
// Pages are the label stock's exact size: a sheet layout's page with its labels in rows and columns,
// or one label per page for a roll. Nothing else is printed on a page (no header or footer), since
// every millimeter of it lands on label stock; the organization's logo is printed only when the print
// asks for it, inside the label.
import PDFDocument from 'pdfkit';
import type { LabelLayout } from '../../../../shared/asset-tags-api.ts';
import { fontFor } from '../../core/export/pdf.ts';
import { darkRuns, matrixRow } from './print-codes.ts';
import { type LabelPlan, type MeasureEm, type TextPlacement } from './print-label.ts';
import { type LabelBox, PT_PER_MM, positionBox, perPage } from './print-layouts.ts';

const P = (mm: number) => mm * PT_PER_MM;
type Doc = InstanceType<typeof PDFDocument>;

/**
 * Picks the font for a piece of text: Helvetica (Bold) for Western European text, otherwise an
 * embedded system font that has the characters (core/export/fonts.ts), registered on first use.
 */
function fontPicker(doc: Doc) {
  const registered = new Set<string>();
  return (text: string, bold: boolean): { name: string; text: string } => {
    const { face, text: shown } = fontFor(text, bold);
    if (!face) return { name: bold ? 'Helvetica-Bold' : 'Helvetica', text: shown };
    if (!registered.has(face.key)) {
      if (face.postscript) doc.registerFont(face.key, face.path, face.postscript);
      else doc.registerFont(face.key, face.path);
      registered.add(face.key);
    }
    return { name: face.key, text: shown };
  };
}

/** Measures text in ems, in the fonts the PDF prints it in. Used to plan labels for PDF and ZPL alike. */
export function pdfMeasure(): MeasureEm {
  const doc = new PDFDocument({ autoFirstPage: false });
  const pick = fontPicker(doc);
  const cache = new Map<string, number>();
  return (text, bold) => {
    const k = `${bold ? 'b' : 'r'}:${text}`;
    let w = cache.get(k);
    if (w === undefined) {
      const f = pick(text, bold);
      w = doc.font(f.name).fontSize(1).widthOfString(f.text);
      cache.set(k, w);
    }
    return w;
  };
}

export interface PdfLabel { box: LabelBox; plan: LabelPlan }

export interface PdfInput {
  layout: LabelLayout;
  labels: PdfLabel[];
  logo: Buffer | null;
  title: string;
  author: string;
  /** An alignment test page: every position outlined and numbered, the first label printed in full. */
  test?: { startAt: number; sample: LabelPlan | null };
}

function text(doc: Doc, pick: ReturnType<typeof fontPicker>, t: TextPlacement, ox: number, oy: number) {
  const f = pick(t.text, true);
  doc.font(f.name).fontSize(P(t.fontSize));
  const w = doc.widthOfString(f.text);
  const x = ox + P(t.x) + Math.max(0, (P(t.width) - w) / 2);
  doc.fillColor('#000000').text(f.text, x, oy + P(t.baseline), { lineBreak: false, baseline: 'alphabetic' });
}

function drawLabel(doc: Doc, pick: ReturnType<typeof fontPicker>, plan: LabelPlan, logo: Buffer | null, ox: number, oy: number) {
  if (plan.logo && logo) {
    try {
      doc.image(logo, ox + P(plan.logo.x), oy + P(plan.logo.y), { fit: [P(plan.logo.width), P(plan.logo.height)], ...(plan.topLine ? {} : { align: 'center' as const }), valign: 'center' });
    } catch { /* an unreadable logo is left out */ }
  }
  if (plan.topLine) text(doc, pick, plan.topLine, ox, oy);
  const c = plan.code;
  if (c) {
    const m = P(c.module);
    const x0 = ox + P(c.x) + c.symbol.quiet * m;
    const y0 = oy + P(c.y);
    doc.fillColor('#000000');
    if (c.symbol.kind === 'linear') {
      for (const [s, n] of darkRuns(c.symbol.modules)) doc.rect(x0 + s * m, y0, n * m, P(c.height));
    } else {
      const sym = c.symbol;
      const ym = y0 + sym.quiet * m;
      for (let y = 0; y < sym.rows; y += 1) {
        for (const [s, n] of darkRuns(matrixRow(sym, y))) doc.rect(x0 + s * m, ym + y * m, n * m, m);
      }
    }
    doc.fill();
  }
  text(doc, pick, plan.value, ox, oy);
}

/** Renders the labels (or the alignment test page) to a PDF. */
export function renderPdf(input: PdfInput): Promise<Buffer> {
  const { layout } = input;
  const doc = new PDFDocument({
    autoFirstPage: false,
    margin: 0,
    info: { Title: input.title, Author: input.author, Creator: 'Sandpiper GRC' },
  });
  const pick = fontPicker(doc);
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const size: [number, number] = [P(layout.pageWidthMm), P(layout.pageHeightMm)];

  if (input.test) {
    doc.addPage({ size, margin: 0 });
    const n = perPage(layout);
    const start = layout.kind === 'sheet' ? Math.min(Math.max(1, input.test.startAt), n) : 1;
    for (let pos = 1; pos <= n; pos += 1) {
      const b = positionBox(layout, pos);
      doc.lineWidth(0.5).strokeColor('#000000').rect(P(b.x), P(b.y), P(b.width), P(b.height)).stroke();
      if (pos === start && input.test.sample) {
        drawLabel(doc, pick, input.test.sample, input.logo, P(b.x), P(b.y));
      } else {
        // Center cross and the position number, to see how far the printer shifts the labels.
        const cx = P(b.x + b.width / 2);
        const cy = P(b.y + b.height / 2);
        doc.lineWidth(0.3).moveTo(cx - 6, cy).lineTo(cx + 6, cy).moveTo(cx, cy - 6).lineTo(cx, cy + 6).stroke();
        doc.font('Helvetica').fontSize(Math.min(9, P(b.height) / 4)).fillColor('#000000')
          .text(String(pos), P(b.x) + 3, P(b.y) + 3, { lineBreak: false });
      }
    }
    if (layout.kind === 'sheet') {
      // A 100 mm rule in the top margin (or the bottom one when the top is too narrow) to check
      // that the page printed at actual size, not scaled to fit.
      const room = layout.marginTopMm >= 8;
      const y = room ? P(Math.min(layout.marginTopMm - 4, 6)) : P(layout.pageHeightMm - 5);
      const x = P((layout.pageWidthMm - 100) / 2);
      doc.lineWidth(0.5).moveTo(x, y).lineTo(x + P(100), y).stroke();
      for (let k = 0; k <= 10; k += 1) doc.moveTo(x + P(k * 10), y - (k % 5 === 0 ? 4 : 2)).lineTo(x + P(k * 10), y).stroke();
      doc.font('Helvetica').fontSize(6).fillColor('#000000')
        .text('100 mm: print at actual size (100 %), not "fit to page".', x, y + 2, { lineBreak: false });
    }
  } else {
    let page = 0;
    for (const l of input.labels) {
      while (page < l.box.page) { doc.addPage({ size, margin: 0 }); page += 1; }
      drawLabel(doc, pick, l.plan, input.logo, P(l.box.x), P(l.box.y));
    }
  }
  doc.end();
  return done;
}
