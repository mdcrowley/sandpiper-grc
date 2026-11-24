// Records retention schedule and file previews (E41-15, E41-16): a destruction of a series' records
// is submitted from its Progress card and refused while the series is under a legal hold; an image
// attached to a record opens in the Preview window without downloading.
// Run alone with: npm run test:e2e -- --only retention-and-files (or --grep retention).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';

/** A small PNG made here (a gradient), so the suite needs no file of its own. */
function png(file) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let x = 0xffffffff; for (const v of buf) x = crcTable[(x ^ v) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const w = 64; const h = 32;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([x * 4, y * 8, 160], y * (w * 3 + 1) + 1 + x * 3);
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2;
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  return file;
}

const ymd = (d) => d.toISOString().slice(0, 10);

const destructionTest = (theme, width) => ({
  name: `retention: a held series stops its destruction, a released one is submitted (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const api = t.api();
    const tag = Date.now().toString(36);
    const { series, destruction, hold } = await t.step('a series past its period, a destruction and a hold', async () => {
      const s = await api.must('POST', '/api/record-series', { title: `E2E series ${tag}`, medium: 'paper', retention_value: 1, retention_unit: 'years', trigger_event: 'closed' });
      const d = await api.must('POST', '/api/records-destructions', { title: `E2E boxes ${tag}`, series_id: s.id, trigger_date: ymd(new Date(Date.now() - 800 * 86_400_000)) });
      const h = await api.must('POST', '/api/legal-holds', { matter: `E2E retention matter ${tag}` });
      await api.must('POST', `/api/legal-holds/${h.id}/records`, { records: [{ type: 'record_series', id: s.id }] });
      return { series: s, destruction: d, hold: h };
    });

    await t.step('the Progress card says a legal hold applies', async () => {
      await page.goto(`/destruction-log/${destruction.id}`);
      await page.waitFor({ text: 'Under a legal hold', tag: 'main *' });
      t.soft((await page.text('main')).includes(hold.ref), 'the hold reference is not shown');
    });
    const refused = await api.call('POST', `/api/records-destructions/${destruction.id}/submit`, {});
    t.soft(refused.status === 409 && refused.body?.error?.code === 'on_hold', `submitting a held destruction answered ${refused.status}`);

    await t.step('released, it is submitted from the card', async () => {
      await api.must('DELETE', `/api/legal-holds/${hold.id}/records?record_type=record_series&record_id=${series.id}`);
      await page.goto(`/destruction-log/${destruction.id}`);
      await page.click({ text: 'Submit for approval', tag: 'button' });
      await page.click({ text: 'Submit', tag: 'button', within: '[role="dialog"]' });
      await page.waitFor({ text: 'Waiting for approval', tag: 'main *' });
    });
  },
});

const previewTest = (theme, width) => ({
  name: `files: an attached image opens in the Preview window (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const api = t.api();
    const tag = Date.now().toString(36);
    const system = await t.step('a system', async () => api.must('POST', '/api/systems', { name: `E2E preview system ${tag}` }));
    const file = png(join(tmpdir(), `e2e-preview-${tag}.png`));
    await t.step('attach an image', async () => {
      await page.goto(`/systems/${system.id}?tab=attachments`);
      await page.waitFor('section[aria-label="Attach files"] input[type=file]');
      await page.upload('section[aria-label="Attach files"] input[type=file]', [file]);
      await page.waitFor(() => /e2e-preview-.*\.png/.test(document.querySelector('ul[aria-label="Attached files"]')?.innerText ?? ''), { timeout: 15000 });
    });
    await t.step('preview it', async () => {
      await page.click(`button[aria-label="Preview e2e-preview-${tag}.png"]`);
      await page.waitFor('[role="dialog"] img.att-preview-image');
      const loaded = await page.fn(() => { const img = document.querySelector('img.att-preview-image'); return Boolean(img && img.complete && img.naturalWidth > 0); });
      t.soft(loaded, 'the image did not load in the preview');
      await page.click({ text: 'Close', tag: 'button', within: '[role="dialog"]' });
    });
  },
});

export const tests = [destructionTest('light', 1440), previewTest('dark', 820)];
