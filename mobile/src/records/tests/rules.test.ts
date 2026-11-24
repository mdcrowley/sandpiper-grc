// The pure rules of the record screens: phone layouts, status choices, patches, conflicts, policy text,
// where items open and the sign-in-again retry.
import { buildPatch, choicesFor, findConflicts, resolvePatch, webOnlyRequirements } from '../edit';
import { checkTyped, toServer } from '../fields';
import { displayValue, recordTitle } from '../format';
import { decodeEntities, htmlToBlocks } from '../html';
import { editableFields, isRestricted, layoutFor, PHONE_TYPES } from '../layouts';
import { searchTarget, workItemTarget } from '../navigate';
import { ReauthCanceled, withReauth } from '../reauth';
import type { Meta, RecordRow } from '../types';
import { FakeApiError, sampleMeta, sampleTicket } from './mocks';

jest.mock('../../api/client', () => require('./mocks').clientMock());

const meta = sampleMeta() as unknown as Meta;
const ticket = meta.resources.ticket;
const event = meta.resources.safety_event;

describe('phone layouts', () => {
  it('covers the eight record types of the spec (and hazards)', () => {
    for (const t of ['asset', 'vehicle', 'site', 'system', 'ticket', 'action', 'safety_event', 'inspection']) expect(PHONE_TYPES).toContain(t);
  });

  it('keeps only fields the type has, and offers mobileEditable fields too', () => {
    const l = layoutFor(ticket);
    expect(l.summary).toEqual(['status', 'priority', 'assignee_id']);
    expect(l.key).not.toContain('asset_id');
    const names = editableFields(ticket).map(([n]) => n);
    expect(names).toEqual(['status', 'assignee_id', 'resolution_notes', 'vendor_ref']);
  });

  it('never offers read-only, JSON or application-managed fields', () => {
    const m = { ...ticket, fields: { ...ticket.fields, status: { ...ticket.fields.status, readOnly: true }, extra: { label: 'X', type: 'json', mobileEditable: true } } } as typeof ticket;
    expect(editableFields(m).map(([n]) => n)).toEqual(['assignee_id', 'resolution_notes', 'vendor_ref']);
    const managed = { ...ticket, lifecycle: { ...ticket.lifecycle!, managed: true } };
    expect(editableFields(managed).map(([n]) => n)).not.toContain('status');
  });

  it('gives other types a general layout with nothing to edit', () => {
    const m = { ...ticket, type: 'gadget' };
    expect(layoutFor(m).editable).toEqual([]);
    expect(layoutFor(m).summary).toContain('status');
  });

  it('knows restricted rows', () => {
    expect(isRestricted(event, { restricted: true })).toBe(true);
    expect(isRestricted(event, { restricted: false })).toBe(false);
    expect(isRestricted({ ...ticket, restricted: true }, {})).toBe(true);
    expect(isRestricted(ticket, { restricted: true })).toBe(false);
  });
});

describe('values', () => {
  const row = sampleTicket() as RecordRow;
  it('shows list labels, people and empty values', () => {
    expect(displayValue('status', ticket.fields.status, row, meta.lookups)).toBe('New');
    expect(displayValue('status', ticket.fields.status, { ...row, _display: {} }, meta.lookups)).toBe('New');
    expect(displayValue('assignee_id', ticket.fields.assignee_id, row)).toBe('Sam Sample');
    expect(displayValue('resolution_notes', ticket.fields.resolution_notes, row)).toBeNull();
    expect(displayValue('x', { label: 'X', type: 'boolean' }, { id: '1', x: false })).toBe('No');
    expect(recordTitle(row, 'title', 'ref')).toBe('Platform display shows no departures');
  });

  it('checks typed numbers and dates and converts them', () => {
    expect(checkTyped({ label: 'D', type: 'date' }, '2027-3-1')).toMatch(/year-month-day/);
    expect(checkTyped({ label: 'D', type: 'date' }, '2027-03-01')).toBeNull();
    expect(checkTyped({ label: 'N', type: 'number' }, 'ten')).toMatch(/number/);
    expect(toServer({ label: 'N', type: 'number' }, '12.5')).toBe(12.5);
    expect(toServer({ label: 'T', type: 'text' }, '')).toBeNull();
  });
});

describe('editing rules', () => {
  const row = sampleTicket() as RecordRow;

  it('offers only the status moves the lifecycle allows from here', () => {
    const values = choicesFor(ticket, 'status', ticket.fields.status, 'new', meta.lookups).map((v) => v.value);
    expect(values).toEqual(['new', 'in_progress', 'resolved']); // closed blocked from new; canceled denied
    expect(choicesFor(ticket, 'priority', ticket.fields.priority, 'high', meta.lookups)).toHaveLength(1);
  });

  it('sends only what changed', () => {
    const fields = editableFields(ticket);
    expect(buildPatch(fields, row, { status: 'new', assignee_id: 'u2', resolution_notes: '' })).toEqual({});
    expect(buildPatch(fields, row, { status: 'in_progress', resolution_notes: 'Rebooted' })).toEqual({ status: 'in_progress', resolution_notes: 'Rebooted' });
  });

  it('sends a status move that needs fields the phone does not show to the web', () => {
    expect(webOnlyRequirements(ticket, row, { status: 'resolved' }, ['status'])).toEqual(['Resolution code']);
    expect(webOnlyRequirements(ticket, { ...row, resolution_code: 'fixed' }, { status: 'resolved' }, ['status'])).toEqual([]);
    expect(webOnlyRequirements(ticket, row, { status: 'in_progress' }, ['status'])).toEqual([]);
  });

  it('finds conflicts only where someone else changed the same field differently', () => {
    const fresh = { ...row, status: 'resolved', resolution_notes: 'Rebooted' } as RecordRow;
    const patch = { status: 'in_progress', resolution_notes: 'Rebooted' };
    const list = findConflicts(ticket, row, patch, fresh);
    expect(list.map((c) => c.name)).toEqual(['status']);
    expect(list[0]).toMatchObject({ before: 'new', mine: 'in_progress', theirs: 'resolved', label: 'Status' });
    expect(resolvePatch(patch, list, { status: true }, fresh)).toEqual({ status: 'in_progress' });
    expect(resolvePatch(patch, list, { status: false }, fresh)).toEqual({});
  });
});

describe('policy text', () => {
  it('turns the server HTML into headings, paragraphs and list items without markup', () => {
    const blocks = htmlToBlocks('<h2>Scope</h2><p>Applies to <strong>all</strong> staff &amp; contractors.</p><ol><li>Lock screens</li><li>Report loss<ul><li>within 1 hour</li></ul></li></ol><blockquote><p>Quote</p></blockquote><script>alert(1)</script>');
    expect(blocks).toEqual([
      { kind: 'heading', level: 2, text: 'Scope' },
      { kind: 'paragraph', text: 'Applies to all staff & contractors.' },
      { kind: 'item', marker: '1.', depth: 0, text: 'Lock screens' },
      { kind: 'item', marker: '2.', depth: 0, text: 'Report loss' },
      { kind: 'item', marker: '•', depth: 1, text: 'within 1 hour' },
      { kind: 'quote', text: 'Quote' },
    ]);
    expect(decodeEntities('&#8217;&#x2014;&nbsp;&bogus;')).toBe('’— &bogus;');
  });
});

describe('where things open', () => {
  const viewable = (t: string) => t === 'ticket';
  const item = { type: 'ticket', id: 't1', label: 'x', ref: null, route: '/tickets/t1', status: null, due: null, overdue: false };
  it('maps My work items and search results', () => {
    expect(workItemTarget('tickets', item, viewable)).toEqual({ app: '/record/ticket/t1' });
    expect(workItemTarget('approvals', { ...item, type: 'workflow_step', id: 's1' }, viewable)).toEqual({ app: '/approvals/step/s1' });
    expect(workItemTarget('approvals', { ...item, type: 'change' }, viewable)).toEqual({ app: '/approvals' });
    expect(workItemTarget('acknowledgments', { ...item, type: 'policy_acknowledgment', id: 'a1' }, viewable)).toEqual({ app: '/approvals/acknowledgment/a1' });
    expect(workItemTarget('training', { ...item, type: 'training_assignment', route: '/training/my' }, viewable)).toEqual({ web: '/training/my' });
    expect(workItemTarget('inspections', { ...item, type: 'inspection', id: 'i1' }, viewable)).toEqual({ app: '/fieldwork/inspection/i1' });
    expect(workItemTarget('condition', { ...item, type: 'asset', id: 'a1', label: 'Pump 2' }, viewable))
      .toEqual({ app: '/fieldwork/condition?type=asset&id=a1&label=Pump+2' });
    // E41-03: due work of other kinds (a section per calendar source) opens the record, else the web page.
    expect(workItemTarget('audits.requests', { ...item, type: 'ticket', id: 'r1' }, viewable)).toEqual({ app: '/record/ticket/r1' });
    expect(workItemTarget('vendors.reassessments', { ...item, type: 'vendor', id: 'v1', route: '/vendors/v1?tab=lifecycle' }, viewable))
      .toEqual({ web: '/vendors/v1?tab=lifecycle' });
    expect(searchTarget({ type: 'vendor', id: 'v1', route: '/vendors/v1' }, viewable)).toEqual({ web: '/vendors/v1' });
  });
});

describe('signing in again for a guarded action', () => {
  it('confirms and retries once on reauth_required', async () => {
    const action = jest.fn()
      .mockRejectedValueOnce(new FakeApiError(403, 'reauth_required', 'Confirm your password to continue.'))
      .mockResolvedValueOnce('done');
    const confirm = jest.fn(async () => true);
    await expect(withReauth(action, confirm)).resolves.toBe('done');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('stops when the person cancels, and passes other errors through', async () => {
    const guarded = jest.fn().mockRejectedValue(new FakeApiError(403, 'reauth_required', 'x'));
    await expect(withReauth(guarded, async () => false)).rejects.toBeInstanceOf(ReauthCanceled);
    expect(guarded).toHaveBeenCalledTimes(1);
    const forbidden = jest.fn().mockRejectedValue(new FakeApiError(403, 'forbidden', 'No'));
    const confirm = jest.fn(async () => true);
    await expect(withReauth(forbidden, confirm)).rejects.toMatchObject({ code: 'forbidden' });
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('values that must stay set', () => {
  it('treats required, defaulted and lifecycle fields as needing a value', () => {
    const { needsValue } = require('../edit');
    const hazard = meta.resources.hazard;
    expect(needsValue(hazard, 'status', hazard.fields.status)).toBe(true); // has a default
    expect(needsValue(hazard, 'source', hazard.fields.source)).toBe(false);
    expect(needsValue(ticket, 'status', ticket.fields.status)).toBe(true); // required and the lifecycle field
    expect(needsValue(ticket, 'priority', ticket.fields.priority)).toBe(false);
  });
});
