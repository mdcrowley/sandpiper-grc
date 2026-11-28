// Merging the structure of a tagged PDF paper into the board book (E45-61). Runs only inside the board
// book sandbox (book-worker.mjs), never in the server process. Plain JavaScript, like the worker.
//
// A tagged paper (MarkInfo /Marked true, a structure tree, no /Suspects) keeps its tags in the book:
//
//   1. Plan (planPaper), on the paper alone: its structure tree is read into a plain tree. Each
//      element's type is resolved through the paper's RoleMap to a standard type (an unknown one becomes
//      Span or Div), a nested Document becomes Div, heading levels are evened out so none is skipped,
//      table and list children the standard does not allow are wrapped (a P straight in a TR goes into a
//      TD, a P in an LI into an LBody), figures with no alternative text get one that says so, and
//      references to annotations and to other streams are left out. Each page's content stream is then
//      rewritten so that every drawing is tagged or an artifact: drawing outside any marked content is
//      wrapped in /Artifact, marked content whose MCID the tree does not point at becomes an artifact,
//      and tagged content inside an artifact (or an artifact inside tagged content) is made plain marked
//      content; properties named in the page's resources are written in place (readers look for the
//      MCID in the operator). MCIDs are per page and every page keeps its own content, so they keep their numbers.
//      A paper whose structure cannot be merged faithfully (marked content inside form XObjects, a
//      content stream that cannot be read, too many elements) gets no plan and is appended as artifacts,
//      as an untagged paper is.
//   2. Apply (attachPaper), on the book: the paper's elements are written under a Part element of the
//      book's Document element (its title names the appendix, its /Lang is the paper's language when it
//      differs from the book's), every element's /Pg points at the copied page, and the book's
//      ParentTree gets an entry per copied page (its /StructParents), from MCID to element.
//
// Library: pdf-lib (MIT), passed in by the caller.

/** The structure types of PDF 1.7 that PDF/UA-1 accepts without a role map (as core/export/pdfua.ts). */
export const STANDARD = new Set([
  'Document', 'Part', 'Art', 'Sect', 'Div', 'BlockQuote', 'Caption', 'TOC', 'TOCI', 'Index', 'NonStruct', 'Private',
  'P', 'H', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'L', 'LI', 'Lbl', 'LBody', 'Table', 'TR', 'TH', 'TD', 'THead', 'TBody', 'TFoot',
  'Span', 'Quote', 'Note', 'Reference', 'BibEntry', 'Code', 'Link', 'Annot', 'Ruby', 'RB', 'RT', 'RP', 'Warichu', 'WT', 'WP',
  'Figure', 'Formula', 'Form',
]);
/** Which children each grouping element may have, and what wraps a child that does not belong. */
const CHILDREN = {
  Table: new Set(['TR', 'THead', 'TBody', 'TFoot', 'Caption']),
  THead: new Set(['TR']), TBody: new Set(['TR']), TFoot: new Set(['TR']),
  TR: new Set(['TH', 'TD']),
  L: new Set(['LI', 'L', 'Caption']),
  LI: new Set(['Lbl', 'LBody']),
};
function wrappersFor(parent, child) {
  if (parent === 'TR') return ['TD'];
  if (parent === 'LI') return ['LBody'];
  if (parent === 'L') return child === 'Lbl' || child === 'LBody' ? ['LI'] : ['LI', 'LBody'];
  return child === 'TH' || child === 'TD' ? ['TR'] : ['TR', 'TD'];
}
/** Limits: past them a paper is appended as artifacts. */
const MAX_ELEMENTS = 200_000;
const MAX_DEPTH = 64;
const MAX_CONTENT_BYTES = 32 * 1024 * 1024;

class NoMerge extends Error {}

const str = (lib, v) => (v instanceof lib.PDFString || v instanceof lib.PDFHexString ? v.decodeText() : null);
const nameOf = (lib, v) => (v instanceof lib.PDFName ? v.decodeText() : null);
const key = (ref) => (ref ? ref.toString() : '');

/** The plan for one paper, or { ok: false, reason } when its structure is not merged. */
export function planPaper(lib, src) {
  try {
    return { ok: true, plan: plan(lib, src) };
  } catch (err) {
    return { ok: false, reason: err instanceof NoMerge ? err.message : `its structure could not be read (${String(err?.message ?? err).slice(0, 120)})` };
  }
}

function plan(lib, src) {
  const { PDFName, PDFDict, PDFArray, PDFNumber, PDFBool, PDFRef } = lib;
  const ctx = src.context;
  const look = (v) => (v instanceof PDFRef ? ctx.lookup(v) : v);
  const catalog = src.catalog;
  const mark = look(catalog.get(PDFName.of('MarkInfo')));
  const marked = mark instanceof PDFDict && look(mark.get(PDFName.of('Marked')));
  if (!(marked instanceof PDFBool) || !marked.asBoolean()) throw new NoMerge('it is not a tagged PDF');
  const suspects = mark.get(PDFName.of('Suspects'));
  if (suspects && look(suspects) instanceof PDFBool && look(suspects).asBoolean()) throw new NoMerge('its tags are marked as unreliable');
  const root = look(catalog.get(PDFName.of('StructTreeRoot')));
  if (!(root instanceof PDFDict) || !root.get(PDFName.of('K'))) throw new NoMerge('it has no structure tree');

  // The paper's role map: a custom type to the standard type it stands for (followed a few steps).
  const roleMap = new Map();
  const rm = look(root.get(PDFName.of('RoleMap')));
  if (rm instanceof PDFDict) for (const [k, v] of rm.entries()) { const n = nameOf(lib, look(v)); if (n) roleMap.set(k.decodeText(), n); }
  const resolve = (role) => {
    let r = role;
    for (let i = 0; i < 8 && r && !STANDARD.has(r); i++) r = roleMap.get(r);
    return r && STANDARD.has(r) ? r : null;
  };

  const pages = src.getPages();
  const pageIndex = new Map(pages.map((p, i) => [key(p.ref), i]));
  /** MCIDs the tree points at, per page. */
  const referenced = pages.map(() => new Set());
  let count = 0;
  const seen = new Set();

  /** A plain element: { role, alt, actual, lang, e, t, attrs, kids: (element | { page, mcid })[] } */
  const walk = (dict, inheritedPage, depth) => {
    if (depth > MAX_DEPTH) throw new NoMerge('its structure tree is nested too deeply');
    if (++count > MAX_ELEMENTS) throw new NoMerge('its structure tree is too large');
    const pgRef = dict.get(PDFName.of('Pg'));
    const page = pgRef instanceof PDFRef && pageIndex.has(key(pgRef)) ? pageIndex.get(key(pgRef)) : inheritedPage;
    const given = nameOf(lib, look(dict.get(PDFName.of('S')))) ?? '';
    const el = {
      given, role: resolve(given),
      alt: str(lib, look(dict.get(PDFName.of('Alt')))), actual: str(lib, look(dict.get(PDFName.of('ActualText')))),
      lang: str(lib, look(dict.get(PDFName.of('Lang')))), e: str(lib, look(dict.get(PDFName.of('E')))), t: str(lib, look(dict.get(PDFName.of('T')))),
      attrs: dict.get(PDFName.of('A')) ?? null, kids: [],
    };
    const k = dict.get(PDFName.of('K'));
    const list = look(k) instanceof PDFArray ? look(k).asArray() : k === undefined ? [] : [k];
    for (const raw of list) {
      const kid = look(raw);
      if (kid instanceof PDFNumber) {
        if (page === null || page === undefined) continue;
        el.kids.push({ page, mcid: kid.asNumber() });
        referenced[page].add(kid.asNumber());
        continue;
      }
      if (!(kid instanceof PDFDict)) continue;
      const type = nameOf(lib, look(kid.get(PDFName.of('Type'))));
      if (type === 'MCR') {
        // Marked content in another stream (a form XObject) is not merged: the paper is appended as artifacts.
        if (kid.get(PDFName.of('Stm'))) throw new NoMerge('its tags point into form XObjects');
        const kp = kid.get(PDFName.of('Pg'));
        const at = kp instanceof PDFRef && pageIndex.has(key(kp)) ? pageIndex.get(key(kp)) : page;
        const mcid = look(kid.get(PDFName.of('MCID')));
        if (at === null || at === undefined || !(mcid instanceof PDFNumber)) continue;
        el.kids.push({ page: at, mcid: mcid.asNumber() });
        referenced[at].add(mcid.asNumber());
        continue;
      }
      if (type === 'OBJR') continue; // annotations are not appended
      if (raw instanceof PDFRef) { if (seen.has(key(raw))) continue; seen.add(key(raw)); }
      const child = walk(kid, page, depth + 1);
      if (child) el.kids.push(child);
    }
    if (!el.kids.length) return null; // nothing of it is on the pages
    return el;
  };
  const top = look(root.get(PDFName.of('K')));
  const tops = top instanceof PDFArray ? top.asArray() : [root.get(PDFName.of('K'))];
  const elements = [];
  for (const raw of tops) {
    const d = look(raw);
    if (!(d instanceof PDFDict)) continue;
    if (raw instanceof PDFRef) { if (seen.has(key(raw))) continue; seen.add(key(raw)); }
    const el = walk(d, null, 0);
    if (el) elements.push(el);
  }
  if (!elements.length) throw new NoMerge('its structure tree points at nothing on its pages');

  // Types: resolved, unknown ones named by what they hold, a nested Document as a Div.
  const isElement = (k) => k && k.kids !== undefined;
  const settle = (el) => {
    if (!el.role) el.role = el.kids.some(isElement) ? 'Div' : 'Span';
    if (el.role === 'Document') el.role = 'Div';
    if (el.role === 'Figure' && !String(el.alt ?? '').trim() && !String(el.actual ?? '').trim()) el.noAlt = true;
    for (const k of el.kids) if (isElement(k)) settle(k);
  };
  elements.forEach(settle);
  // Children a table or list may not hold are wrapped (a P in a TR goes into a TD).
  const wrap = (el) => {
    const allowed = CHILDREN[el.role];
    el.kids = el.kids.map((k) => {
      if (!isElement(k) || !allowed || allowed.has(k.role)) return k;
      let inner = k;
      for (const role of wrappersFor(el.role, k.role).reverse()) inner = { role, kids: [inner], wrapper: true };
      return inner;
    });
    for (const k of el.kids) if (isElement(k)) wrap(k);
  };
  elements.forEach(wrap);
  // Heading levels evened out: never more than one deeper than the heading before (the book's
  // "Appendices" heading is an H2, so a paper may start at H3 or higher).
  let last = 2;
  const level = (el) => {
    const m = /^H([1-6])$/.exec(el.role);
    if (m) { const lv = Math.min(Number(m[1]), last + 1); el.role = `H${lv}`; last = lv; }
    for (const k of el.kids) if (isElement(k)) level(k);
  };
  elements.forEach(level);

  // Each page's content: every drawing tagged or an artifact.
  const contents = pages.map((page, i) => rewritePage(lib, src, page, referenced[i]));
  const lang = str(lib, look(catalog.get(PDFName.of('Lang'))));
  return { elements, contents, lang, srcContext: ctx };
}

// ---------- content streams ----------

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);
const DRAWING = new Set(['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'sh', 'Do', 'Tj', 'TJ', "'", '"', 'EI']);

/** The decoded bytes of a page's content (its streams joined). */
function pageContent(lib, page) {
  const { PDFArray, PDFRef, PDFRawStream } = lib;
  const ctx = page.node.context;
  const raw = page.node.get(lib.PDFName.of('Contents'));
  if (!raw) return new Uint8Array(0);
  const target = raw instanceof PDFRef ? ctx.lookup(raw) : raw;
  const streams = target instanceof PDFArray ? target.asArray().map((r) => ctx.lookup(r)) : [target];
  const parts = [];
  let size = 0;
  for (const s of streams) {
    if (!(s instanceof PDFRawStream)) throw new NoMerge('a page has content that cannot be read');
    const bytes = lib.decodePDFRawStream(s).decode();
    size += bytes.length + 1;
    if (size > MAX_CONTENT_BYTES) throw new NoMerge('a page has too much content');
    parts.push(bytes, new Uint8Array([10]));
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** Whether a form XObject used by the page (or one inside it) carries marked-content ids. */
function formsHaveMcids(lib, page) {
  const { PDFName, PDFDict, PDFRawStream, PDFRef } = lib;
  const ctx = page.node.context;
  const seen = new Set();
  const visit = (resources, depth) => {
    if (!(resources instanceof PDFDict) || depth > 4) return false;
    const xo = ctx.lookup(resources.get(PDFName.of('XObject')));
    if (!(xo instanceof PDFDict)) return false;
    for (const [, ref] of xo.entries()) {
      if (ref instanceof PDFRef) { if (seen.has(key(ref))) continue; seen.add(key(ref)); }
      const s = ctx.lookup(ref);
      if (!(s instanceof PDFRawStream)) continue;
      if (lib.PDFName.of('Form') !== s.dict.get(PDFName.of('Subtype'))) continue;
      let bytes;
      try { bytes = lib.decodePDFRawStream(s).decode(); } catch { return true; }
      if (Buffer.from(bytes).includes('MCID')) return true;
      if (visit(ctx.lookup(s.dict.get(PDFName.of('Resources'))), depth + 1)) return true;
    }
    return false;
  };
  return visit(page.node.Resources(), 0);
}

/** The operations of a content stream: { op, start, end, operands }. Operands are parsed values. */
export function tokenize(b) {
  const ops = [];
  let i = 0;
  let operands = [];
  let opStart = -1;
  const skip = () => {
    for (;;) {
      while (i < b.length && WS.has(b[i])) i++;
      if (b[i] === 37) { while (i < b.length && b[i] !== 10 && b[i] !== 13) i++; continue; }
      return;
    }
  };
  const regular = () => { const s = i; while (i < b.length && !WS.has(b[i]) && !DELIM.has(b[i])) i++; return Buffer.from(b.subarray(s, i)).toString('latin1'); };
  const value = (depth = 0) => {
    if (depth > 32) throw new NoMerge('a page has content nested too deeply');
    const c = b[i];
    if (c === 47) { i++; return { name: regular() }; }
    if (c === 40) { // literal string, with nesting and escapes
      let n = 1; i++;
      while (i < b.length && n > 0) { if (b[i] === 92) i += 2; else { if (b[i] === 40) n++; else if (b[i] === 41) n--; i++; } }
      return { string: true };
    }
    if (c === 60 && b[i + 1] === 60) {
      i += 2;
      const dict = new Map();
      for (;;) {
        skip();
        if (i >= b.length) throw new NoMerge('a page has content that cannot be read');
        if (b[i] === 62 && b[i + 1] === 62) { i += 2; return { dict }; }
        const k = value(depth + 1);
        skip();
        const v = value(depth + 1);
        if (k && k.name !== undefined) dict.set(k.name, v);
      }
    }
    if (c === 60) { while (i < b.length && b[i] !== 62) i++; i++; return { string: true }; }
    if (c === 91) {
      i++;
      const arr = [];
      for (;;) {
        skip();
        if (i >= b.length) throw new NoMerge('a page has content that cannot be read');
        if (b[i] === 93) { i++; return { arr }; }
        arr.push(value(depth + 1));
      }
    }
    if (c === 123 || c === 125 || c === 41 || c === 62 || c === 93) { i++; return { junk: true }; }
    const word = regular();
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { num: Number(word) };
    return { kw: word };
  };
  for (;;) {
    skip();
    if (i >= b.length) break;
    if (opStart < 0) opStart = i;
    const v = value();
    if (v.kw === undefined || v.kw === 'true' || v.kw === 'false' || v.kw === 'null') { operands.push(v); continue; }
    if (v.kw === 'BI') {
      // An inline image: its parameters up to ID, then binary data up to EI (preceded and followed by white space).
      for (;;) {
        skip();
        if (i >= b.length) throw new NoMerge('a page has an inline image that cannot be read');
        const p = value();
        if (p.kw === 'ID') break;
      }
      i++;
      let found = -1;
      for (let j = i; j + 1 < b.length; j++) {
        if (b[j] === 69 && b[j + 1] === 73 && WS.has(b[j - 1]) && (j + 2 >= b.length || WS.has(b[j + 2]) || DELIM.has(b[j + 2]))) { found = j; break; }
      }
      if (found < 0) throw new NoMerge('a page has an inline image that cannot be read');
      i = found + 2;
      ops.push({ op: 'EI', start: opStart, end: i, operands: [] });
    } else {
      ops.push({ op: v.kw, start: opStart, end: i, operands });
    }
    operands = [];
    opStart = -1;
  }
  return ops;
}

/** The page's content with every drawing tagged or an artifact (see the top of this file). */
function rewritePage(lib, src, page, referenced) {
  if (formsHaveMcids(lib, page)) throw new NoMerge('its tags point into form XObjects');
  const b = pageContent(lib, page);
  const ops = tokenize(b);
  const { PDFName, PDFDict, PDFNumber } = lib;
  const ctx = page.node.context;
  const props = ctx.lookup(page.node.Resources()?.get(PDFName.of('Properties')));
  const mcidOf = (op) => {
    const p = op.operands[1];
    if (p?.dict) { const m = p.dict.get('MCID'); return m && m.num !== undefined && Number.isInteger(m.num) ? m.num : null; }
    if (p?.name !== undefined && props instanceof PDFDict) {
      const d = ctx.lookup(props.get(PDFName.of(p.name)));
      const m = d instanceof PDFDict ? ctx.lookup(d.get(PDFName.of('MCID'))) : null;
      return m instanceof PDFNumber ? m.asNumber() : null;
    }
    return null;
  };
  const out = [];
  const text = (s) => out.push(Buffer.from(s, 'latin1'));
  const keep = (op) => out.push(b.subarray(op.start, op.end), Buffer.from('\n'));
  const stack = [];
  let run = null;
  const flush = () => {
    if (!run) return;
    if (run.drawing) text('/Artifact BMC\n');
    for (const op of run.ops) keep(op);
    if (run.drawing) text('EMC\n');
    run = null;
  };
  let changed = false;
  for (const op of ops) {
    if (op.op === 'BMC' || op.op === 'BDC') {
      flush();
      const tag = op.operands[0]?.name ?? '';
      const mcid = op.op === 'BDC' ? mcidOf(op) : null;
      const inArtifact = stack.some((s) => s.artifact);
      const inTagged = stack.some((s) => s.mcid !== null);
      if (tag === 'Artifact') {
        if (inTagged) { text('/Span BMC\n'); stack.push({ artifact: false, mcid: null }); changed = true; } else { keep(op); stack.push({ artifact: true, mcid: null }); }
      } else if (mcid !== null && inArtifact) {
        text('/Span BMC\n'); stack.push({ artifact: false, mcid: null }); changed = true;
      } else if (mcid !== null && !referenced.has(mcid)) {
        // Tagged content the structure tree does not point at: page furniture as far as anyone can tell.
        // Inside other tagged content it is simply part of that content.
        text(inTagged ? '/Span BMC\n' : '/Artifact BMC\n'); stack.push({ artifact: !inTagged, mcid: null }); changed = true;
      } else if (mcid !== null && op.operands[1]?.name !== undefined) {
        // Properties named in the page's resources: written in place, as readers look for the MCID there.
        text(`/${tag} <</MCID ${mcid}>> BDC\n`); stack.push({ artifact: false, mcid }); changed = true;
      } else {
        keep(op); stack.push({ artifact: false, mcid });
      }
      continue;
    }
    if (op.op === 'EMC') {
      flush();
      if (!stack.length) { changed = true; continue; } // an unmatched end
      stack.pop();
      keep(op);
      continue;
    }
    if (op.op === 'BT' || op.op === 'ET') { flush(); keep(op); continue; }
    if (stack.some((s) => s.artifact || s.mcid !== null)) { keep(op); continue; }
    if (!run) run = { ops: [], drawing: false };
    run.ops.push(op);
    if (DRAWING.has(op.op)) { run.drawing = true; changed = true; }
  }
  flush();
  for (let n = stack.length; n > 0; n--) { text('EMC\n'); changed = true; }
  return changed ? Buffer.concat(out) : null;
}

// ---------- applying the plan to the book ----------

/** The book's structure: its Document element and its ParentTree as a map (key to array of refs). */
export function bookStructure(lib, book) {
  const { PDFName, PDFDict, PDFArray, PDFNumber, PDFRef } = lib;
  const ctx = book.context;
  const look = (v) => (v instanceof PDFRef ? ctx.lookup(v) : v);
  const root = look(book.catalog.get(PDFName.of('StructTreeRoot')));
  if (!(root instanceof PDFDict)) return null;
  const k = look(root.get(PDFName.of('K')));
  const first = k instanceof PDFArray ? k.get(0) : root.get(PDFName.of('K'));
  const docRef = first instanceof PDFRef ? first : null;
  if (!docRef) return null;
  const entries = new Map();
  const read = (node, depth) => {
    if (!(node instanceof PDFDict) || depth > 16) return;
    const nums = look(node.get(PDFName.of('Nums')));
    if (nums instanceof PDFArray) for (let i = 0; i + 1 < nums.size(); i += 2) {
      const n = look(nums.get(i));
      if (n instanceof PDFNumber) entries.set(n.asNumber(), nums.get(i + 1));
    }
    const kids = look(node.get(PDFName.of('Kids')));
    if (kids instanceof PDFArray) for (const kid of kids.asArray()) read(look(kid), depth + 1);
  };
  read(look(root.get(PDFName.of('ParentTree'))), 0);
  const lang = book.catalog.get(PDFName.of('Lang'));
  return { root, docRef, entries, lang: lang instanceof lib.PDFString || lang instanceof lib.PDFHexString ? lang.decodeText() : null };
}

/** A copy of a plain PDF value (an attribute dictionary) from the paper into the book; streams and deep references are left out. */
function copyPlain(lib, from, to, v, depth = 0) {
  const { PDFDict, PDFArray, PDFRef, PDFStream } = lib;
  if (depth > 8 || v === undefined || v === null) return null;
  if (v instanceof PDFRef) return copyPlain(lib, from, to, from.lookup(v), depth + 1);
  if (v instanceof PDFStream) return null;
  if (v instanceof PDFDict) {
    const d = to.obj({});
    for (const [k, x] of v.entries()) { const c = copyPlain(lib, from, to, x, depth + 1); if (c) d.set(k, c); }
    return d;
  }
  if (v instanceof PDFArray) {
    const a = to.obj([]);
    for (const x of v.asArray()) { const c = copyPlain(lib, from, to, x, depth + 1); if (c) a.push(c); }
    return a;
  }
  return v; // names, numbers, strings, booleans: context-free values
}

/**
 * Writes the paper's structure into the book under a new Part element, pointing at `pageRefs` (the
 * copied pages, in the paper's order), and gives each copied page its ParentTree entry.
 */
export function attachPaper(lib, book, structure, planned, pageRefs, pageNodes, title, nextKey) {
  const { PDFName, PDFString, PDFArray, PDFNull } = lib;
  const ctx = book.context;
  const docEl = ctx.lookup(structure.docRef);
  const mcidOwners = pageRefs.map(() => []);
  const S = (role) => PDFName.of(role);
  const make = (el, parentRef) => {
    const ref = ctx.nextRef();
    const d = ctx.obj({ Type: 'StructElem' });
    d.set(PDFName.of('S'), S(el.role));
    d.set(PDFName.of('P'), parentRef);
    if (el.t) d.set(PDFName.of('T'), PDFString.of(el.t.slice(0, 500)));
    if (el.lang) d.set(PDFName.of('Lang'), PDFString.of(el.lang.slice(0, 35)));
    if (el.alt) d.set(PDFName.of('Alt'), PDFString.of(el.alt.slice(0, 2000)));
    else if (el.noAlt) d.set(PDFName.of('Alt'), PDFString.of(`A picture in ${title}; the paper gave no description of it.`.slice(0, 500)));
    if (el.actual) d.set(PDFName.of('ActualText'), PDFString.of(el.actual.slice(0, 2000)));
    if (el.e) d.set(PDFName.of('E'), PDFString.of(el.e.slice(0, 500)));
    if (el.attrs) { const a = copyPlain(lib, planned.srcContext, ctx, el.attrs); if (a) d.set(PDFName.of('A'), a); }
    const firstPage = (function find(x) { for (const k of x.kids) { if (k.mcid !== undefined) return k.page; const p = find(k); if (p !== undefined) return p; } return undefined; })(el);
    if (firstPage !== undefined) d.set(PDFName.of('Pg'), pageRefs[firstPage]);
    const kids = ctx.obj([]);
    for (const k of el.kids) {
      if (k.mcid !== undefined) {
        mcidOwners[k.page][k.mcid] = ref;
        kids.push(k.page === firstPage ? ctx.obj(k.mcid) : ctx.obj({ Type: 'MCR', Pg: pageRefs[k.page], MCID: k.mcid }));
      } else kids.push(make(k, ref));
    }
    d.set(PDFName.of('K'), kids);
    ctx.assign(ref, d);
    return ref;
  };
  const partRef = ctx.nextRef();
  const part = ctx.obj({ Type: 'StructElem', S: 'Part', P: structure.docRef });
  part.set(PDFName.of('T'), PDFString.of(title.slice(0, 500)));
  if (planned.lang && planned.lang.toLowerCase() !== String(structure.lang ?? '').toLowerCase()) part.set(PDFName.of('Lang'), PDFString.of(planned.lang.slice(0, 35)));
  const kids = ctx.obj([]);
  for (const el of planned.elements) kids.push(make(el, partRef));
  part.set(PDFName.of('K'), kids);
  ctx.assign(partRef, part);
  // The Part goes at the end of the book's Document element.
  const docKids = docEl.get(PDFName.of('K'));
  const list = docKids instanceof PDFArray ? docKids : ctx.lookup(docKids);
  if (list instanceof PDFArray) list.push(partRef);
  else docEl.set(PDFName.of('K'), ctx.obj(docKids ? [docKids, partRef] : [partRef]));
  // Each page: its own content (rewritten where needed) and a ParentTree entry from MCID to element.
  let n = nextKey;
  for (const [i, node] of pageNodes.entries()) {
    const content = planned.contents[i];
    if (content) node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(content)));
    const owners = mcidOwners[i];
    if (!owners.length) continue;
    const arr = ctx.obj([]);
    for (let m = 0; m < owners.length; m++) arr.push(owners[m] ?? PDFNull);
    structure.entries.set(n, ctx.register(arr));
    node.set(PDFName.of('StructParents'), ctx.obj(n));
    n += 1;
  }
  return n;
}

/** Writes the book's ParentTree back (flat) with its next key. */
export function finishStructure(lib, book, structure, nextKey) {
  const { PDFName } = lib;
  const ctx = book.context;
  const nums = ctx.obj([]);
  for (const k of [...structure.entries.keys()].sort((a, b) => a - b)) { nums.push(ctx.obj(k)); nums.push(structure.entries.get(k)); }
  structure.root.set(PDFName.of('ParentTree'), ctx.register(ctx.obj({ Nums: nums })));
  structure.root.set(PDFName.of('ParentTreeNextKey'), ctx.obj(nextKey));
}

/** The next free ParentTree key of the book. */
export function nextParentKey(lib, structure) {
  const next = structure.root.get(lib.PDFName.of('ParentTreeNextKey'));
  const given = next instanceof lib.PDFNumber ? next.asNumber() : 0;
  return Math.max(given, ...[...structure.entries.keys()].map((k) => k + 1), 0);
}
