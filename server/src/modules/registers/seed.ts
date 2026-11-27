// Sample data (dev profile only): one register an administrator might define, with invented records.
import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { checkRegister, createRegister } from './admin.ts';
import { typeOf, type Registers } from './definitions.ts';

const KEY = 'lost_property';

const FIELDS = [
  { key: 'found_on', label: 'Found on', type: 'date', position: 10 },
  { key: 'found_where', label: 'Where found', type: 'text', position: 20, help: 'The place the item was found or handed in.' },
  {
    key: 'category', label: 'Kind of item', type: 'select', position: 30,
    options: [['bag', 'Bag'], ['phone', 'Phone'], ['wallet', 'Wallet or purse'], ['keys', 'Keys'], ['clothing', 'Clothing'], ['other', 'Other']],
  },
];

const RECORDS = [
  { title: '[Sample] Black backpack with a laptop', status: 'open', custom: { found_on: -2, found_where: 'Bus 2041, rear seats', category: 'bag' } },
  { title: '[Sample] Phone in a blue case', status: 'in_progress', custom: { found_on: -5, found_where: 'Central station, platform 2', category: 'phone' } },
  { title: '[Sample] Bunch of three keys', status: 'closed', custom: { found_on: -20, found_where: 'North depot yard', category: 'keys' } },
];

export async function seedRegisters(ctx: ModuleContext, regs: Registers, opts: SeedOptions): Promise<string | void> {
  if (opts.profile !== 'dev') return;
  const type = typeOf(KEY);
  if (!regs.rows.has(KEY)) {
    const values = await checkRegister(ctx, regs, {
      key: KEY, label: 'Lost property item', plural: 'Lost property', prefix: 'LP', nav_group: 'IT services', icon: 'box', title_label: 'Item',
      description: 'Items found and handed in, kept until the owner collects them or they are disposed of.',
    }, null);
    await createRegister(ctx, regs, values, null);
  }
  if (regs.state.get(KEY) !== 'ready' || !ctx.resources.get(type)) return 'registers: the sample register is waiting for the database owner';
  for (const f of FIELDS) {
    if (await ctx.db.one('select 1 from custom_fields where record_type = $1 and key = $2', [type, f.key])) continue;
    let list: string | null = null;
    if (f.options) {
      list = `cf_${type}_${f.key}`;
      await ctx.lookups.ensure(list, f.options.map(([value, label], i) => ({ value, label, color: 'gray', sort: (i + 1) * 10 })), { module: KEY });
    }
    await ctx.db.query(
      `insert into custom_fields (record_type, key, label, type, required, list_key, position, help) values ($1,$2,$3,$4,false,$5,$6,$7)`,
      [type, f.key, f.label, f.type, list, f.position, f.help ?? null]);
  }
  let made = 0;
  for (const r of RECORDS) {
    if (await ctx.db.one(`select 1 from ${type} where title = $1`, [r.title])) continue;
    const row = await ctx.resources.create(type, { title: r.title, status: r.status }, null);
    const custom: Row = { ...r.custom, found_on: dayInZone(r.custom.found_on) };
    await ctx.db.query(`update ${type} set custom = $2::jsonb where id = $1`, [row.id, JSON.stringify(custom)]);
    made += 1;
  }
  return `registers: 1 register, ${made} records`;
}
