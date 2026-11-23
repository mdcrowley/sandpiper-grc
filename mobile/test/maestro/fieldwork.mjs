// Data for the field work flows (wave 15, E38-11 and E38-12), and the check on the server afterward.
// Invented records only. Uses the server's own API as the person the flows sign in as.
//
//   node fieldwork.mjs setup <server> <username> <password>   → prints KEY=value lines for the flows
//   node fieldwork.mjs check <server> <username> <password> <inspectionId> <countId>   → exit 1 on a failure
const [mode, base, username, password, inspectionId, countId] = process.argv.slice(2);
let cookie = '';
async function call(method, path, body) {
  const res = await fetch(base + path, {
    method, headers: { 'content-type': 'application/json', 'x-grc-csrf': '1', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set && /grc_session=/.test(set)) cookie = set.split(';')[0];
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (res.status >= 400) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
  return json;
}
await call('POST', '/api/auth/login', { username, password });
const me = (await call('GET', '/api/auth/state')).user;
const run = Date.now().toString(36);

if (mode === 'setup') {
  const today = new Date().toISOString().slice(0, 10);
  const depot = await call('POST', '/api/sites', { name: `Invented depot ${run}` });
  const other = await call('POST', '/api/sites', { name: `Invented yard ${run}` });
  const a1 = await call('POST', '/api/assets', { name: `Invented charger A ${run}`, site_id: depot.id });
  const a2 = await call('POST', '/api/assets', { name: `Invented charger B ${run}`, site_id: depot.id });
  const stray = await call('POST', '/api/assets', { name: `Invented charger C ${run}`, site_id: other.id });
  const count = await call('POST', '/api/inventory-counts/start', { site_id: depot.id, record_types: ['asset'] });
  const tpl = await call('POST', '/api/checklist-templates', { name: `Invented depot walk ${run}`, kind: 'inspection', target_type: 'site' });
  await call('PUT', `/api/checklist-templates/${tpl.id}/items`, { items: [{ prompt: 'Invented exits clear', critical: true }, { prompt: 'Invented lights working' }] });
  const ins = await call('POST', '/api/inspections', { template_id: tpl.id, target_type: 'site', target_id: depot.id, inspector_id: me.id, due_on: today });
  for (const [k, v] of Object.entries({
    INSPECTION: ins.ref, INSPECTION_ID: ins.id, COUNT: count.ref, COUNT_ID: count.id, TAG1: a1.tag, TAG2: a2.tag, STRAY: stray.tag,
  })) console.log(`${k}=${v}`);
} else if (mode === 'check') {
  let ok = true;
  const expect = (what, good) => { console.log(`${good ? 'OK  ' : 'FAIL'} ${what}`); if (!good) ok = false; };
  const ins = await call('GET', `/api/inspections/${inspectionId}`);
  expect(`inspection ${ins.ref} complete with result pass (${ins.status}, ${ins.result})`, ins.status === 'complete' && ins.result === 'pass');
  expect(`signed by ${ins.signed_by_name}`, ins.signed_by_name === me.displayName || Boolean(ins.signed_by_name));
  const files = await call('GET', `/api/attachments?record_type=inspection&record_id=${inspectionId}`);
  const rows = files.rows ?? files;
  expect(`the drawn signature is attached (${rows.map((r) => r.file_name).join(', ')})`, rows.some((r) => /^signature-.*\.png$/.test(r.file_name)));
  const history = await call('GET', `/api/history?record_type=inspection&record_id=${inspectionId}`);
  const events = (history.rows ?? history).filter((e) => e.action === 'inspection.complete');
  expect(`completed once (${events.length} completion event)`, events.length === 1);
  const items = await call('GET', `/api/inventory-counts/${countId}/items`);
  expect(`count totals: ${JSON.stringify(items.totals)}`, items.totals.found === 2 && items.totals.unexpected === 1 && items.totals.pending === 0);
  process.exit(ok ? 0 : 1);
}
