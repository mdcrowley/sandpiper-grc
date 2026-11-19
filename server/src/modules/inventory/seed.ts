import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { seedDevEstate, seedSampleAssets } from './seed-sample.ts';

/**
 * `grc.ps1 seed`. Profile `pilot` loads the three inventory files from the seed folder
 * (each is optional: a file that is not there is skipped and named in the summary);
 * profile `dev` generates a small invented estate. Both add invented sample assets.
 * Everything is an upsert by name, so the command is safe to run again.
 */

/** Creates the record, or updates the one with the same name. `fillOnly` keys never overwrite a value already set. */
export async function upsertByName(
  ctx: ModuleContext, type: string, table: string, data: Row, fillOnly: Row = {},
): Promise<{ row: Row; created: boolean }> {
  const existing = await ctx.db.one<Row>(
    `select * from ${table} where lower(name) = lower($1) and deleted_at is null order by created_at limit 1`, [data.name],
  );
  if (!existing) return { row: await ctx.resources.create(type, { ...data, ...fillOnly }), created: true };
  const patch: Row = { ...data };
  for (const [k, v] of Object.entries(fillOnly)) {
    if ((existing[k] === null || existing[k] === undefined) && v !== null && v !== undefined) patch[k] = v;
  }
  return { row: await ctx.resources.update(type, existing.id, patch), created: false };
}

const blank = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

/** Hosting type from free text, only where the text is unambiguous; otherwise nothing. */
export function deriveHosting(textIn: string | null): { hosting_type: string | null; hosting_provider: string | null } {
  const none = { hosting_type: null, hosting_provider: null };
  const text = (textIn ?? '').trim();
  if (!text) return none;
  const first = text.split(';')[0].trim();
  if (/^vendor[- ](cloud|hosted)\b/i.test(first)) return { hosting_type: 'vendor_hosted', hosting_provider: null };
  if (/^on[- ]premises?\b/i.test(first) && !/cloud/i.test(text)) return { hosting_type: 'on_premises', hosting_provider: null };
  // "<owner> server(s)" and nothing else: anything about a move or a sync is left for a person to decide.
  if (/^\S+ servers?$/i.test(text)) return { hosting_type: 'on_premises', hosting_provider: null };
  const cloud = /^(\S+) cloud\b/i.exec(first);
  if (cloud && !/server|premises/i.test(text)) return { hosting_type: 'cloud', hosting_provider: cloud[1] };
  return none;
}

/** System status from the status-and-outlook text, only for the two plain cases. */
export function deriveStatus(textIn: string | null): string | null {
  const text = (textIn ?? '').trim();
  if (/\b(being|to be) replaced\b/i.test(text)) return 'being_replaced';
  if (/^in use\b/i.test(text)) return 'in_use';
  return null;
}

const STOP = new Set(['and', 'or', 'of', 'the', 'a', 'an', 'data', 'records', 'record', 'files', 'file', 'information', 'held', 'if', 'any', 'by', 'who', 'including', 'other', 'others']);
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));
const sameWord = (a: string, b: string) =>
  a === b || (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a)));

/**
 * Data categories that a free-text description clearly names: at least two thirds of the
 * category name's significant words appear in the text (all of them for short names).
 */
export function matchCategories<T extends { name: string }>(text: string | null, categories: T[]): T[] {
  const have = words(text ?? '');
  if (!have.length) return [];
  return categories.filter((c) => {
    const need = words(c.name);
    if (!need.length) return false;
    const hits = need.filter((n) => have.some((h) => sameWord(n, h))).length;
    return hits >= Math.ceil((need.length * 2) / 3);
  });
}

/** True when `text` contains `name` as a whole phrase. Very short names are ignored. */
export function namesPhrase(text: string | null, name: string): boolean {
  if (!text || name.trim().length < 4) return false;
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
}

async function seedPilot(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  const missing: string[] = [];
  const read = (file: string): Row[] => {
    if (existsSync(join(opts.seedDir, file))) return ctx.readSeed(opts, file, '|');
    missing.push(file);
    return [];
  };
  const siteRows = read('sites.psv').filter((r) => blank(r['Site']));
  const sites: Row[] = [];
  for (const r of siteRows) {
    const { row } = await upsertByName(ctx, 'site', 'sites', {
      name: blank(r['Site']),
      address: blank(r['Address']),
      function: blank(r['Function']),
      technology: blank(r['Technology known to be there']),
      protection_notes: blank(r['Power and physical protection']),
      third_parties: blank(r['Others on site']),
      to_confirm: blank(r['To confirm']),
    });
    sites.push(row);
  }

  const categoryRows = read('data_categories.psv').filter((r) => blank(r['Data category']));
  const categories: Row[] = [];
  for (const r of categoryRows) {
    const { row } = await upsertByName(ctx, 'data_category', 'data_categories', {
      name: blank(r['Data category']),
      contains: blank(r['What it contains']),
      where_held: blank(r['Where held']),
      custodian: blank(r['Custodian (role)']),
      shared_with: blank(r['Shared with']),
      governing_rule: blank(r['Rule or agreement that applies']),
      retention_period: blank(r['Retention found']),
      gaps: blank(r['Gaps']),
    });
    categories.push(row);
  }

  const systemRows = read('systems.psv').filter((r) => blank(r['System']));
  let dataLinks = 0;
  let siteLinks = 0;
  for (const r of systemRows) {
    const hostingText = blank(r['Hosting']);
    const outlook = blank(r['Status and outlook']);
    const sensitive = blank(r['Sensitive data held']);
    const hosting = deriveHosting(hostingText);
    const { row } = await upsertByName(ctx, 'system', 'systems', {
      name: blank(r['System']),
      system_group: blank(r['Group']),
      vendor_name: blank(r['Vendor']),
      function: blank(r['What it does']),
      users: blank(r['Main users']),
      hosting_notes: hostingText,
      status_outlook: outlook,
      sensitive_data_held: sensitive,
      agreement_on_file: blank(r['Agreement on file']),
      source: blank(r['Source']),
      to_confirm: blank(r['To confirm']),
    }, {
      // Derived values: set on first load, never written over a value someone has chosen.
      hosting_type: hosting.hosting_type,
      hosting_provider: hosting.hosting_provider,
      status: deriveStatus(outlook),
    });
    for (const c of matchCategories(sensitive, categories as { id: string; name: string }[])) {
      const made = await ctx.db.one(
        'insert into system_data_categories (system_id, data_category_id) values ($1,$2) on conflict do nothing returning system_id',
        [row.id, c.id],
      );
      if (made) dataLinks++;
    }
    for (const s of sites) {
      if (!namesPhrase(s.technology, row.name)) continue;
      const made = await ctx.db.one(
        'insert into system_sites (system_id, site_id) values ($1,$2) on conflict do nothing returning system_id', [row.id, s.id],
      );
      if (made) siteLinks++;
    }
  }
  if (dataLinks || siteLinks) {
    await ctx.audit(null, {
      action: 'inventory.seed_links', recordType: 'system',
      summary: `Seed linked systems to ${dataLinks} data categories and ${siteLinks} sites from the recorded text`,
    });
  }
  return `systems ${systemRows.length}, sites ${siteRows.length}, data categories ${categoryRows.length}`
    + `, new links: ${dataLinks} to data categories, ${siteLinks} to sites`
    + (missing.length ? `, not in the seed folder and skipped: ${missing.join(', ')}` : '');
}

export async function seedInventory(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  const estate = opts.profile === 'pilot' ? await seedPilot(ctx, opts) : await seedDevEstate(ctx);
  // Invented assets are tied to invented records only: in the pilot they stay unlinked.
  const assets = await seedSampleAssets(ctx, { link: opts.profile === 'dev' });
  return `${estate}; ${assets}`;
}
