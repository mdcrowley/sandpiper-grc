// An automated PDF/UA-1 (ISO 14289-1) check for the PDFs the server makes (E41-13), used by the
// unit tests. It reads the file with pdf.js (`pdfjs-dist`, Apache-2.0, a development dependency
// only: nothing here runs in the application) and applies the machine-checkable requirements of
// the Matterhorn Protocol that a generated document can fail:
//
//   - the document is marked as tagged (MarkInfo /Marked true, not /Suspects) with a structure tree;
//   - the XMP metadata names PDF/UA part 1 and carries a title (dc:title), and the viewer is told to
//     show that title (DisplayDocTitle);
//   - the document's natural language is set (catalog /Lang);
//   - every piece of content (text, paths, images) is either tagged (marked content with an MCID
//     that the structure tree points at) or an artifact, never neither and never both;
//   - every font that prints text is embedded;
//   - every structure element is a standard type; figures carry alternative text; headings start at
//     H1 and never skip a level; tables are made of rows of header and data cells; lists of items
//     with a label and a body.
//
// What it cannot judge (as for any automated check) is left to a person: whether the alternative
// text is good, whether the reading order makes sense, whether colors carry meaning alone.
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** The structure types of PDF 1.7 (ISO 32000-1, 14.8.4) that PDF/UA-1 accepts without a role map. */
const STANDARD = new Set([
  'Document', 'Part', 'Art', 'Sect', 'Div', 'BlockQuote', 'Caption', 'TOC', 'TOCI', 'Index', 'NonStruct', 'Private',
  'P', 'H', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'L', 'LI', 'Lbl', 'LBody', 'Table', 'TR', 'TH', 'TD', 'THead', 'TBody', 'TFoot',
  'Span', 'Quote', 'Note', 'Reference', 'BibEntry', 'Code', 'Link', 'Annot', 'Ruby', 'RB', 'RT', 'RP', 'Warichu', 'WT', 'WP',
  'Figure', 'Formula', 'Form',
]);
/** Which children each grouping element may have. */
const CHILDREN: Record<string, Set<string>> = {
  Table: new Set(['TR', 'THead', 'TBody', 'TFoot', 'Caption']),
  THead: new Set(['TR']), TBody: new Set(['TR']), TFoot: new Set(['TR']),
  TR: new Set(['TH', 'TD']),
  L: new Set(['LI', 'L', 'Caption']),
  LI: new Set(['Lbl', 'LBody']),
};
const DRAWING = new Set<number>([
  OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke,
  OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText, OPS.shadingFill,
  OPS.paintImageMaskXObject, OPS.paintImageMaskXObjectGroup, OPS.paintImageXObject, OPS.paintInlineImageXObject,
  OPS.paintInlineImageXObjectGroup, OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObjectRepeat, OPS.paintSolidColorImageMask,
]);
const TEXT = new Set<number>([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText]);

/** A value from what pdf.js gives for a dictionary: a Map or a plain object. */
const pick = (v: unknown, key: string): unknown => (v instanceof Map ? v.get(key) : v && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined);

interface StructNode { role?: string; alt?: string; lang?: string; type?: string; id?: string; children?: StructNode[] }

export interface PdfUaReport {
  /** Every requirement the file fails, in words; empty when it passes. */
  failures: string[];
  /** What was looked at, for tests that check the structure itself. */
  pages: number;
  lang: string | null;
  title: string | null;
  /** Structure element roles in document order (page by page). */
  roles: string[];
  /** Alternative texts of figures, in order. */
  figures: string[];
  /** Heading roles in order (H1, H2...). */
  headings: string[];
}

/** Checks a PDF against the machine-checkable requirements of PDF/UA-1. */
export async function checkPdfUa(pdf: Buffer | Uint8Array): Promise<PdfUaReport> {
  const failures: string[] = [];
  const fail = (s: string) => { if (!failures.includes(s)) failures.push(s); };
  const task = getDocument({ data: new Uint8Array(pdf), disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  try {
    const mark = await doc.getMarkInfo();
    if (!pick(mark, 'Marked')) fail('The document is not marked as tagged (MarkInfo /Marked).');
    if (pick(mark, 'Suspects')) fail('The document says its tags may be wrong (MarkInfo /Suspects).');
    const { info, metadata } = await doc.getMetadata();
    const lang = String((info as Record<string, unknown>).Language ?? '').trim() || null;
    if (!lang) fail('The document has no natural language (catalog /Lang).');
    const title = metadata?.get('dc:title')?.toString().trim() || null;
    if (!metadata) fail('The document has no XMP metadata.');
    else {
      if (!title) fail('The XMP metadata has no title (dc:title).');
      if (String(metadata.get('pdfuaid:part') ?? '') !== '1') fail('The XMP metadata does not identify the file as PDF/UA-1 (pdfuaid:part).');
    }
    const prefs = await doc.getViewerPreferences();
    if (!pick(prefs, 'DisplayDocTitle')) fail('The viewer is not told to show the document title (ViewerPreferences /DisplayDocTitle).');

    const roles: string[] = [];
    const figures: string[] = [];
    const headings: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const tree = (await page.getStructTree()) as StructNode | null;
      const referenced = new Set<number>();
      const walk = (node: StructNode, parent: string | null) => {
        if (node.type === 'content') { const m = /_mc(\d+)$/.exec(node.id ?? ''); if (m) referenced.add(Number(m[1])); return; }
        if (node.type) return; // an annotation or object reference
        const role = node.role ?? '';
        if (role !== 'Root') {
          roles.push(role);
          if (!STANDARD.has(role)) fail(`Page ${n}: "${role}" is not a standard structure type.`);
          if (parent && CHILDREN[parent] && !CHILDREN[parent].has(role)) fail(`Page ${n}: a ${role} element sits inside a ${parent}, which may hold only ${[...CHILDREN[parent]].join(', ')}.`);
          if (role === 'Figure') {
            if (!node.alt?.trim()) fail(`Page ${n}: a figure has no alternative text.`);
            else figures.push(node.alt);
          }
          if (/^H[1-6]$/.test(role)) headings.push(role);
        }
        for (const c of node.children ?? []) walk(c, role === 'Root' ? null : role);
      };
      if (tree) walk(tree, null);

      // Every drawing operation must be inside marked content: tagged (with an MCID) or an artifact.
      const ops = await page.getOperatorList();
      const stack: { tag: string; mcid: number | null }[] = [];
      const used = new Set<number>();
      let untagged = 0;
      const fonts = new Set<string>();
      let font: string | null = null;
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        const args = ops.argsArray[i] as unknown[] | null;
        if (fn === OPS.beginMarkedContentProps || fn === OPS.beginMarkedContent) {
          const tag = String((args?.[0] as { name?: string })?.name ?? args?.[0] ?? '');
          const mcid = fn === OPS.beginMarkedContentProps && Number.isInteger(args?.[1]) ? (args![1] as number) : null;
          const inArtifact = stack.some((s) => s.tag === 'Artifact');
          const inTagged = stack.some((s) => s.mcid !== null);
          if (tag === 'Artifact' && inTagged) fail(`Page ${n}: an artifact is nested inside tagged content.`);
          if (mcid !== null && inArtifact) fail(`Page ${n}: tagged content is nested inside an artifact.`);
          if (mcid !== null) used.add(mcid);
          stack.push({ tag, mcid });
          continue;
        }
        if (fn === OPS.endMarkedContent) { stack.pop(); continue; }
        if (fn === OPS.setFont) font = String(args?.[0] ?? '');
        const drawing = DRAWING.has(fn) || (fn === OPS.constructPath && args?.[0] !== OPS.endPath);
        if (!drawing) continue;
        if (TEXT.has(fn) && font) fonts.add(font);
        if (!stack.some((s) => s.tag === 'Artifact' || s.mcid !== null)) untagged += 1;
      }
      if (untagged) fail(`Page ${n}: ${untagged} drawing operation(s) are neither tagged nor marked as artifacts.`);
      if (used.size && !tree) fail(`Page ${n}: content is tagged but the page has no structure tree.`);
      for (const id of used) if (!referenced.has(id)) fail(`Page ${n}: marked content ${id} is not part of the structure tree.`);
      for (const id of fonts) {
        const f = page.commonObjs.has(id) ? page.commonObjs.get(id) as { missingFile?: boolean; name?: string } : null;
        if (f?.missingFile) fail(`Page ${n}: the font ${f.name ?? id} is not embedded.`);
      }
      page.cleanup();
    }
    if (!roles.length) fail('The document has no structure tree.');
    if (headings.length && headings[0] !== 'H1') fail(`The first heading is ${headings[0]}, not H1.`);
    for (let i = 1; i < headings.length; i++) {
      const a = Number(headings[i - 1].slice(1));
      const b = Number(headings[i].slice(1));
      if (b > a + 1) fail(`A heading level is skipped: ${headings[i - 1]} is followed by ${headings[i]}.`);
    }
    return { failures, pages: doc.numPages, lang, title, roles, figures, headings };
  } finally {
    await task.destroy();
  }
}
