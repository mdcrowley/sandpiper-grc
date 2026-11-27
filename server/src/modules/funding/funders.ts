// Funders (E45-09): the organizations that fund awards, ask for yearly certifications and review how
// awards are managed. One record per funder (`funder`, FDR-), shared by awards, certifications and
// compliance reviews through `funder_id`. Those keep `funder_name` as a copy of the funder's name, so
// search, exports and older API clients go on working: a save that gives only a name finds the funder
// of that name, or files a new one. No funder is built in.
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { cleanText } from './shared.ts';

const URL_RE = /^https?:\/\/[^\s<>"]{1,500}$/i;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
export const FUNDER_TABLES = ['funding_awards', 'funding_certifications', 'compliance_reviews'];

/**
 * Keeps `funder_id` and `funder_name` of an award, certification or review in step (call from
 * beforeCreate and beforeUpdate). A funder chosen by id gives its name; a name typed alone finds or
 * files the funder.
 */
export async function applyFunder(ctx: ModuleContext, req: FastifyRequest | null, patch: Row): Promise<Row> {
  if ('funder_id' in patch) {
    if (patch.funder_id) {
      const f = await ctx.db.one<Row>('select name from funders where id = $1 and deleted_at is null', [patch.funder_id]);
      if (!f) ctx.fail(400, 'validation', 'Check the highlighted fields.', { funder_id: 'Choose a funder.' });
      patch.funder_name = f!.name;
    } else if (!('funder_name' in patch) || !cleanText(patch.funder_name, 200)) {
      patch.funder_id = null;
      patch.funder_name = null;
    } else {
      delete patch.funder_id;
    }
  }
  if ('funder_name' in patch && !('funder_id' in patch)) {
    const name = cleanText(patch.funder_name, 200);
    patch.funder_name = name;
    patch.funder_id = name ? await funderByName(ctx, req, name) : null;
  }
  return patch;
}

/** The funder of this name (case does not matter), filed now when there is none. */
export async function funderByName(ctx: ModuleContext, req: FastifyRequest | null, name: string): Promise<string> {
  const found = await ctx.db.one<Row>('select id from funders where lower(name) = lower($1) and deleted_at is null order by created_at limit 1', [name]);
  if (found) return found.id;
  return (await ctx.resources.create('funder', { name }, req)).id;
}

export function registerFunders(ctx: ModuleContext) {
  const { db } = ctx;

  function check(merged: Row, patch: Row) {
    const errors: Record<string, string> = {};
    if ('website' in patch && patch.website) {
      patch.website = String(patch.website).trim();
      if (!URL_RE.test(patch.website)) errors.website = 'Give a web address that starts with https:// or http://.';
    }
    if ('contact_email' in patch && patch.contact_email) {
      patch.contact_email = String(patch.contact_email).trim();
      if (!EMAIL_RE.test(patch.contact_email)) errors.contact_email = 'Give an email address.';
    }
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    return merged;
  }

  ctx.defineResource({
    type: 'funder', table: 'funders', module: 'funding', label: 'Funder', plural: 'Funders',
    path: '/api/funders', route: '/funding/funders', titleField: 'name',
    ref: { field: 'ref', prefix: 'FDR-' },
    searchable: ['name', 'notes'],
    defaultSort: { field: 'name', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      name: { label: 'Funder', type: 'text', required: true, personal: false },
      vendor_id: { label: 'Also in the vendor register as', type: 'ref', to: 'vendor' },
      contact_name: { label: 'Contact', type: 'text' },
      contact_email: { label: 'Contact email', type: 'text' },
      website: { label: 'Website', type: 'text', personal: false },
      notes: { label: 'Notes', type: 'longtext', personal: false },
    },
    hooks: {
      beforeCreate: (_req, data) => { check(data, data); return data; },
      beforeUpdate: (_req, existing, patch) => { check({ ...existing, ...patch }, patch); return patch; },
      // The copies of the name follow a rename.
      afterUpdate: async (_req, before, after) => {
        if (before.name === after.name) return;
        for (const table of FUNDER_TABLES) await db.query(`update ${table} set funder_name = $2 where funder_id = $1`, [after.id, after.name]);
      },
    },
  });

  ctx.app.get('/api/funders/:id/summary', { preHandler: ctx.requirePerm('funding.view') }, async (req) => {
    const funder = await ctx.resources.find('funder', String((req.params as Row).id ?? ''), req.user) ?? ctx.fail(404, 'not_found', 'Funder not found.');
    const n = async (table: string) => Number((await db.one<Row>(`select count(*)::int as n from ${table} where funder_id = $1 and deleted_at is null`, [funder.id]))!.n);
    return { awards: await n('funding_awards'), certifications: await n('funding_certifications'), reviews: await n('compliance_reviews') };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/funders/:id/summary', tag: 'Funding', permission: 'funding.view',
    summary: 'How many awards, certifications and compliance reviews a funder has (the same for everyone)', response: '{ awards, certifications, reviews }',
  });
}
