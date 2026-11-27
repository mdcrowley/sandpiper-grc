// The work done inside the board book sandbox (wave 25): reading the PDF papers of a meeting (how many
// pages each has) and appending them to the board book. It runs in a worker thread with its own heap
// limit, inside a separate process that the server kills when it takes too long (book-sandbox.ts,
// book-reader.mjs), so a hostile PDF can never take the server down. Plain JavaScript, so the same
// file runs under the development runner, the tests and the container's Node.
//
// An appended page keeps its drawing as it is, inside an artifact (marked content `/Artifact`): the
// board book's own pages carry the structure (PDF/UA), and the paper's own structure, annotations and
// links are left out. Nothing a file contains is ever run.
//
// Library: pdf-lib (MIT).
import { parentPort, workerData } from 'node:worker_threads';

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

/** How many pages each file has, or why it cannot be appended. */
async function inspect() {
  const { PDFDocument } = await import('pdf-lib');
  const out = [];
  for (const bytes of payload.files) {
    try {
      const doc = await open(PDFDocument, bytes);
      const pages = doc.getPageCount();
      out.push(pages > payload.maxPages ? { ok: false, code: 'too_large', error: `more than ${payload.maxPages} pages` } : { ok: true, pages });
    } catch (err) {
      out.push({ ok: false, code: err.code || 'unreadable', error: String(err.message).slice(0, 200) });
    }
  }
  return out;
}

/** The board book with every file's pages appended, each page's drawing marked as an artifact. */
async function merge() {
  const { PDFDocument, PDFName } = await import('pdf-lib');
  const book = await PDFDocument.load(payload.book, { updateMetadata: false });
  const start = book.context.register(book.context.stream('/Artifact BMC\n'));
  const end = book.context.register(book.context.stream('\nEMC\n'));
  let total = book.getPageCount();
  for (const bytes of payload.files) {
    const src = await open(PDFDocument, bytes);
    const pages = await book.copyPages(src, src.getPageIndices());
    for (const page of pages) {
      if (++total > payload.maxPages) throw Object.assign(new Error(`the book would have more than ${payload.maxPages} pages`), { code: 'too_large' });
      // The paper's own structure, links and form fields do not belong to the book's structure tree.
      for (const key of ['StructParents', 'Annots', 'Tabs']) page.node.delete(PDFName.of(key));
      if (page.node.Contents()) {
        page.node.normalize();
        page.node.wrapContentStreams(start, end);
      }
      book.addPage(page);
    }
  }
  const out = await book.save();
  return { bytes: out, pages: book.getPageCount() };
}

try {
  const result = task === 'inspect' ? await inspect() : task === 'merge' ? await merge() : null;
  if (result === null) throw Object.assign(new Error(`unknown task ${task}`), { code: 'unknown' });
  parentPort.postMessage({ ok: true, result });
} catch (err) {
  parentPort.postMessage({ ok: false, error: String((err && err.message) || err).slice(0, 300), code: (err && err.code) || null });
}
