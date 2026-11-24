// Printed tags as a PDF (E37-08), made with PDFKit, the engine every server PDF uses (core/export).
// Pages are the label stock's exact size: a sheet layout's page with its labels in rows and columns,
// or one label per page for a roll. Nothing else is printed on a page (no header or footer), since
// every millimeter of it lands on label stock; the organization's logo is printed only when the print
// asks for it, inside the label.
//
// Like every server PDF the file is tagged for PDF/UA (E41-13): each label is a section holding its
// top line and value as paragraphs and its code as a figure whose text alternative names the value;
// the logo, the alignment page's outlines, crosses, position numbers and ruler are artifacts. Text is
// printed in the application's own embedded font (core/export/fonts.ts), which has Helvetica's widths.
import PDFDocument from 'pdfkit';
import type { LabelLayout } from '../../../../shared/asset-tags-api.ts';
import { asArtifact, fontFor, setBaseFont, structOf, taggedDocument } from '../../core/export/pdf.ts';
import { darkRuns, matrixRow } from './print-codes.ts';
import { type LabelPlan, type MeasureEm, type TextPlacement } from './print-label.ts';
import { type LabelBox, PT_PER_MM, positionBox, perPage } from './print-layouts.ts';

const P = (mm: number) => mm * PT_PER_MM;
type Doc = InstanceType<typeof PDFDocument>;

/**
 * Sets the font for a piece of text and returns the text to print: the application's own font for
 * Western European text, otherwise an embedded system font that has the characters
 * (core/export/fonts.ts), registered on first use.
 */
function fontPicker(doc: Doc) {
  const registered = new Set<string>();
  return (text: string, bold: boolean): string => {
    const { face, text: shown } = fontFor(text, bold);
    if (!face) { setBaseFont(doc, bold); return shown; }
    if (!registered.has(face.key)) {
      if (face.postscript) doc.registerFont(face.key, face.path, face.postscript);
      else doc.registerFont(face.key, face.path);
      registered.add(face.key);
    }
    doc.font(face.key);
    return shown;
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
      const shown = pick(text, bold);
      w = doc.fontSize(1).widthOfString(shown);
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
  const shown = pick(t.text, true);
  doc.fontSize(P(t.fontSize));
  const w = doc.widthOfString(shown);
  const x = ox + P(t.x) + Math.max(0, (P(t.width) - w) / 2);
  doc.fillColor('#000000').text(shown, x, oy + P(t.baseline), { lineBreak: false, baseline: 'alphabetic' });
}

/** One label, tagged as a section under `parent`: its top line, its code (a figure named by the value) and its value. */
function drawLabel(doc: Doc, pick: ReturnType<typeof fontPicker>, plan: LabelPlan, logo: Buffer | null, ox: number, oy: number, parent: PDFKit.PDFStructureElement) {
  const label = structOf(doc, 'Sect', {});
  parent.add(label);
  const box = plan.logo;
  if (box && logo) {
    // The logo repeats on every label: decoration, not content.
    asArtifact(doc, () => {
      try {
        doc.image(logo, ox + P(box.x), oy + P(box.y), { fit: [P(box.width), P(box.height)], ...(plan.topLine ? {} : { align: 'center' as const }), valign: 'center' });
      } catch { /* an unreadable logo is left out */ }
    });
  }
  const top = plan.topLine;
  if (top) label.add(structOf(doc, 'P', {}, () => text(doc, pick, top, ox, oy)));
  const c = plan.code;
  if (c) {
    const alt = `${c.symbol.kind === 'linear' ? 'Barcode' : 'Two-dimensional code'} for ${plan.value.text}`;
    label.add(structOf(doc, 'Figure', { alt }, () => {
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
    }));
  }
  label.add(structOf(doc, 'P', {}, () => text(doc, pick, plan.value, ox, oy)));
  label.end();
}

/** Renders the labels (or the alignment test page) to a PDF. */
export function renderPdf(input: PdfInput): Promise<Buffer> {
  const { layout } = input;
  const doc = taggedDocument({ title: input.title, author: input.author, autoFirstPage: false, margin: 0 });
  const root = structOf(doc, 'Document', {});
  doc.addStructure(root);
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
      asArtifact(doc, () => doc.lineWidth(0.5).strokeColor('#000000').rect(P(b.x), P(b.y), P(b.width), P(b.height)).stroke());
      if (pos === start && input.test.sample) {
        drawLabel(doc, pick, input.test.sample, input.logo, P(b.x), P(b.y), root);
      } else {
        // Center cross and the position number, to see how far the printer shifts the labels.
        const cx = P(b.x + b.width / 2);
        const cy = P(b.y + b.height / 2);
        asArtifact(doc, () => {
          doc.lineWidth(0.3).moveTo(cx - 6, cy).lineTo(cx + 6, cy).moveTo(cx, cy - 6).lineTo(cx, cy + 6).stroke();
          setBaseFont(doc, false);
          doc.fontSize(Math.min(9, P(b.height) / 4)).fillColor('#000000').text(String(pos), P(b.x) + 3, P(b.y) + 3, { lineBreak: false });
        });
      }
    }
    if (layout.kind === 'sheet') {
      // A 100 mm rule in the top margin (or the bottom one when the top is too narrow) to check
      // that the page printed at actual size, not scaled to fit.
      const room = layout.marginTopMm >= 8;
      const y = room ? P(Math.min(layout.marginTopMm - 4, 6)) : P(layout.pageHeightMm - 5);
      const x = P((layout.pageWidthMm - 100) / 2);
      asArtifact(doc, () => {
        doc.lineWidth(0.5).moveTo(x, y).lineTo(x + P(100), y).stroke();
        for (let k = 0; k <= 10; k += 1) doc.moveTo(x + P(k * 10), y - (k % 5 === 0 ? 4 : 2)).lineTo(x + P(k * 10), y).stroke();
      });
      root.add(structOf(doc, 'P', {}, () => {
        setBaseFont(doc, false);
        doc.fontSize(6).fillColor('#000000').text('100 mm: print at actual size (100 %), not "fit to page".', x, y + 2, { lineBreak: false });
      }));
    }
  } else {
    let page = 0;
    for (const l of input.labels) {
      while (page < l.box.page) { doc.addPage({ size, margin: 0 }); page += 1; }
      drawLabel(doc, pick, l.plan, input.logo, P(l.box.x), P(l.box.y), root);
    }
  }
  root.end();
  doc.end();
  return done;
}
