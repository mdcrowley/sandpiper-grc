// The work done inside the board book sandbox (wave 25): reading the PDF papers of a meeting (how many
// pages each has) and appending them to the board book. It runs in a worker thread with its own heap
// limit, inside a separate process that the server kills when it takes too long (book-sandbox.ts,
// book-reader.mjs), so a hostile PDF can never take the server down. Plain JavaScript, so the same
// file runs under the development runner, the tests and the container's Node.
//
// A tagged paper keeps its structure (E45-61): its structure tree is merged under a Part element of the
// book's tree, and its pages' content is made fully tagged or artifact (book-structure.mjs). An untagged
// paper, or one whose structure cannot be merged faithfully, keeps its drawing as it is inside an
// artifact (marked content `/Artifact`), and the text-only version of the book prints its text instead.
// Annotations and links of papers are left out. Nothing a file contains is ever run.
//
// Library: pdf-lib (MIT).
import { parentPort, workerData } from 'node:worker_threads';
import { attachPaper, bookStructure, finishStructure, nextParentKey, planPaper } from './book-structure.mjs';

const { task, payload } = workerData;

async function open(PDFDocument, bytes) {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    const message = String((err && err.message) || err);
    if (/encrypt/i.test(message)) throw Object.assign(new Error('the PDF is protected by a password or encrypted'), { code: 'encrypted' });
    throw Object.assign(new Error(`the file is not a readable PDF (${message.slice(0, 120)})`), { code: 'unreadable' });
  }
}

/** How many pages each file has and whether its structure is merged (`tagged`; else `untagged` says why), or why it cannot be appended. */
async function inspect() {
  const lib = await import('pdf-lib');
  const out = [];
  for (const bytes of payload.files) {
    try {
      const doc = await open(lib.PDFDocument, bytes);
      const pages = doc.getPageCount();
      if (pages > payload.maxPages) { out.push({ ok: false, code: 'too_large', error: `more than ${payload.maxPages} pages` }); continue; }
      const planned = planPaper(lib, doc);
      out.push(planned.ok ? { ok: true, pages, tagged: true } : { ok: true, pages, tagged: false, untagged: planned.reason });
    } catch (err) {
      out.push({ ok: false, code: err.code || 'unreadable', error: String(err.message).slice(0, 200) });
    }
  }
  return out;
}

/**
 * The board book with every file's pages appended: a tagged paper's structure merged under a Part
 * element named by `payload.titles[i]`, an untagged paper's drawing marked as an artifact.
 */
async function merge() {
  const lib = await import('pdf-lib');
  const { PDFDocument, PDFName } = lib;
  const book = await PDFDocument.load(payload.book, { updateMetadata: false });
  const start = book.context.register(book.context.stream('/Artifact BMC\n'));
  const end = book.context.register(book.context.stream('\nEMC\n'));
  const structure = bookStructure(lib, book);
  let key = structure ? nextParentKey(lib, structure) : 0;
  let total = book.getPageCount();
  const tagged = [];
  for (const [n, bytes] of payload.files.entries()) {
    const src = await open(PDFDocument, bytes);
    const planned = structure ? planPaper(lib, src) : { ok: false };
    const pages = await book.copyPages(src, src.getPageIndices());
    for (const page of pages) {
      if (++total > payload.maxPages) throw Object.assign(new Error(`the book would have more than ${payload.maxPages} pages`), { code: 'too_large' });
      // The paper's own structure entries, links and form fields: the book gives the page its own.
      for (const k of ['StructParents', 'Annots', 'Tabs']) page.node.delete(PDFName.of(k));
      if (!planned.ok && page.node.Contents()) {
        page.node.normalize();
        page.node.wrapContentStreams(start, end);
      }
      book.addPage(page);
    }
    if (planned.ok) {
      const title = String(payload.titles?.[n] ?? `Appendix ${n + 1}`);
      key = attachPaper(lib, book, structure, planned.plan, pages.map((p) => p.ref), pages.map((p) => p.node), title, key);
    }
    tagged.push(Boolean(planned.ok));
  }
  if (structure) finishStructure(lib, book, structure, key);
  const out = await book.save();
  return { bytes: out, pages: book.getPageCount(), tagged };
}

try {
  const result = task === 'inspect' ? await inspect() : task === 'merge' ? await merge() : null;
  if (result === null) throw Object.assign(new Error(`unknown task ${task}`), { code: 'unknown' });
  parentPort.postMessage({ ok: true, result });
} catch (err) {
  parentPort.postMessage({ ok: false, error: String((err && err.message) || err).slice(0, 300), code: (err && err.code) || null });
}
