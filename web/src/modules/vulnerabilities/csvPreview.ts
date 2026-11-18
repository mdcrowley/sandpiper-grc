// Reads just enough of a CSV text in the browser to offer the columns and a preview.
// The server parses the whole file again and is the one that decides what is valid.

export function detectDelimiter(text: string): string {
  const header = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  let best = ',';
  let most = 0;
  for (const d of [',', ';', '\t', '|']) {
    const n = header.split(d).length - 1;
    if (n > most) { most = n; best = d; }
  }
  return best;
}

/** The first `limit` non-empty records (the header is the first). Quotes are handled. */
export function firstRecords(input: string, delimiter: string, limit: number): string[][] {
  const text = input.replace(/^﻿/, '');
  const rows: string[][] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  const end = () => {
    cells.push(cell);
    cell = '';
    if (cells.some((c) => c.trim() !== '')) rows.push(cells);
    cells = [];
  };
  for (let i = 0; i < text.length && rows.length < limit; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delimiter) { cells.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      end();
    } else cell += c;
  }
  if (rows.length < limit && (cell !== '' || cells.length)) end();
  return rows;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Common column names in scanner exports, by the field they usually mean. */
const ALIASES: Record<string, string[]> = {
  host_name: ['host', 'hostname', 'dnsname', 'fqdn', 'netbiosname', 'assetname', 'computername', 'device', 'target'],
  host_ip: ['ip', 'ipaddress', 'address', 'ipv4', 'hostip'],
  port: ['port', 'portnumber'],
  service: ['service', 'protocol', 'servicename'],
  plugin_id: ['pluginid', 'plugin', 'qid', 'checkid', 'findingid', 'vulnid', 'vulnerabilityid', 'ruleid', 'id'],
  title: ['title', 'name', 'pluginname', 'vulnerability', 'vulnerabilityname', 'finding', 'summary'],
  severity: ['severity', 'risk', 'riskfactor', 'severitylevel', 'threat', 'rating'],
  cvss: ['cvss', 'cvssscore', 'cvssbasescore', 'cvssv3', 'cvssv3basescore', 'cvss3basescore', 'cvssv2basescore', 'score'],
  cves: ['cve', 'cves', 'cveid', 'cveids'],
  known_exploited: ['knownexploited', 'exploited', 'kev', 'exploitedinthewild'],
  first_seen: ['firstseen', 'firstfound', 'firstdetected', 'firstdiscovered', 'firstobserved'],
  last_seen: ['lastseen', 'lastfound', 'lastdetected', 'lastobserved', 'scandate'],
  description: ['description', 'synopsis', 'details'],
  solution: ['solution', 'remediation', 'fix', 'recommendation'],
};

/** Best guess of which column holds which field. Each column is used once. */
export function guessMapping(headers: string[], fields: { key: string; label: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const f of fields) {
    const wanted = [norm(f.key), norm(f.label), ...(ALIASES[f.key] ?? [])];
    const hit = wanted.map((w) => headers.find((h) => !used.has(h) && norm(h) === w)).find(Boolean);
    if (hit) { out[f.key] = hit; used.add(hit); }
  }
  return out;
}
