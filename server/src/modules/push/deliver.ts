// Delivery: tells each person's registered phones "You have N new notifications" once something new
// is in their notification list. What reaches the list follows each person's choices (notifications
// module): a kind they switched off, or chose to receive by email only, is not in the list and is
// never pushed; a switched-off area's notifications are neither listed nor pushed.
//
// Claimed per person: a run moves the person's cursor (push_cursor.pushed_upto) to their newest
// notification with a conditional upsert before sending, and only the run that moved it sends, so two
// runs at the same moment (two processes, or the hook's job and the sweep) send once.
import type { ModuleContext, Row } from '../../core/module.ts';
import { pushMessageText, type ApnsEnvironment, type PushProvider } from '../../../../shared/push-api.ts';
import { mobileOn, settleDisabled, settleSwitchedOff } from '../mobile/state.ts';
import { shownSql, switchedOffParams } from '../notifications/service.ts';
import { apnsClient } from './apns.ts';
import { anyOn, loadCredentials, targetContext, type PushCredentials } from './config.ts';
import { fcmClient } from './fcm.ts';
import type { PushMessage, SendOutcome } from './types.ts';
import { unifiedPushClient, type WebPushTarget } from './webpush.ts';
import { secretBox } from '../../core/auth.ts';

/** What delivery needs of the module context (tests pass the app, its database and a settings reader). */
export type PushDeps = Pick<ModuleContext, 'db' | 'app' | 'settings'>;

export interface DeliveryResult { people: number; sent: number; failed: number; removed: number }

const tableExists = async (db: ModuleContext['db'], t: string) =>
  Boolean((await db.one<{ t: string | null }>('select to_regclass($1)::text as t', [`public.${t}`]))?.t);

/** Whether push can run at all: the Mobile app area on, and the mobile and notifications modules installed. */
export async function pushPossible(ctx: PushDeps): Promise<boolean> {
  if (!(await tableExists(ctx.db, 'mobile_devices')) || !(await tableExists(ctx.db, 'notifications'))) return false;
  return mobileOn(ctx.db);
}

/** Registrations of phones no longer signed in go (the trigger in migration 001 does it at once; this catches the rest). */
export async function forgetSignedOut(ctx: PushDeps): Promise<number> {
  await settleSwitchedOff(ctx.db);
  await settleDisabled(ctx.db);
  return (await ctx.db.query(
    `delete from push_registrations r where not exists (
       select 1 from mobile_devices d where d.id = r.device_id and d.revoked_at is null and d.user_id = r.user_id)
     returning r.id`,
  )).length;
}

type Target = { token: string } | WebPushTarget;

/** Sends one message to one registration with whichever client serves it. */
export type Sender = (reg: { provider: PushProvider; environment: ApnsEnvironment; target: Target }, m: PushMessage) => Promise<SendOutcome>;

export function makeSender(c: PushCredentials): { send: Sender; close: () => void } {
  const apns = c.apns ? apnsClient(c.apns) : null;
  const fcm = c.fcm ? fcmClient(c.fcm) : null;
  const up = c.unifiedpush ? unifiedPushClient(c.unifiedpush) : null;
  const off = (what: string): SendOutcome => ({ ok: false, gone: false, message: `${what} is switched off on the server.` });
  return {
    async send(reg, m) {
      try {
        if (reg.provider === 'apns') return apns ? await apns.send((reg.target as { token: string }).token, reg.environment, m) : off('Apple push');
        if (reg.provider === 'fcm') return fcm ? await fcm.send((reg.target as { token: string }).token, m) : off('Firebase push');
        return up ? await up.send(reg.target as WebPushTarget, m) : off('UnifiedPush');
      } catch (err) {
        return { ok: false, gone: false, message: (err as Error).message.slice(0, 300) };
      }
    },
    close: () => apns?.close(),
  };
}

/** Sends to every registration of one person; records each outcome and removes the ones that are gone. */
export async function sendToPerson(ctx: PushDeps, userId: string, m: PushMessage, sender: Sender, providers: (p: PushProvider) => boolean) {
  const out = { sent: 0, failed: 0, removed: 0 };
  const box = secretBox(ctx.db);
  const regs = await ctx.db.query<Row>(
    `select r.id, r.provider, r.environment, r.target_sealed from push_registrations r
     join mobile_devices d on d.id = r.device_id and d.revoked_at is null and d.user_id = r.user_id
     where r.user_id = $1`, [userId],
  );
  for (const r of regs) {
    if (!providers(r.provider)) continue;
    let target: Target;
    try {
      target = JSON.parse(box.decrypt(r.target_sealed, targetContext(r.id)));
    } catch {
      await ctx.db.query('delete from push_registrations where id = $1', [r.id]);
      out.removed += 1;
      continue;
    }
    const res = await sender({ provider: r.provider, environment: r.environment, target }, m);
    if (res.ok) {
      out.sent += 1;
      await ctx.db.query('update push_registrations set last_sent_at = now(), failures = 0, last_error = null, last_error_at = null where id = $1', [r.id]);
    } else if (res.gone) {
      out.removed += 1;
      await ctx.db.query('delete from push_registrations where id = $1', [r.id]);
    } else {
      out.failed += 1;
      await ctx.db.query(
        'update push_registrations set failures = failures + 1, last_error = $2, last_error_at = now() where id = $1', [r.id, res.message.slice(0, 500)],
      );
    }
  }
  return out;
}

export async function appTitle(ctx: PushDeps): Promise<string> {
  return String(await ctx.settings.get('app.name', 'Sandpiper GRC')).slice(0, 60) || 'Sandpiper GRC';
}

/**
 * One delivery run: everyone with a registered phone and a notification newer than their cursor is
 * told how many unread notifications they have. Safe to run at any time and in several processes.
 */
export async function deliverPending(ctx: PushDeps): Promise<DeliveryResult> {
  const result: DeliveryResult = { people: 0, sent: 0, failed: 0, removed: 0 };
  if (!(await pushPossible(ctx))) return result;
  const creds = await loadCredentials(ctx.db);
  result.removed += await forgetSignedOut(ctx);
  if (!anyOn(creds)) return result;
  const [offTypes, offPaths] = switchedOffParams(ctx.app);
  const shown = shownSql(1, 2, 'n.');
  // newest as text: a timestamp keeps its microseconds, so the cursor matches the row exactly.
  const due = await ctx.db.query<{ user_id: string; newest: string }>(
    `select r.user_id, max(n.created_at)::text as newest
     from (select user_id, min(created_at) as since from push_registrations group by user_id) r
     join users u on u.id = r.user_id and u.status = 'active' and u.deleted_at is null
     join notifications n on n.user_id = r.user_id
     left join push_cursor c on c.user_id = r.user_id
     where n.in_app and n.dismissed_at is null and n.read_at is null and ${shown}
       and n.created_at > coalesce(c.pushed_upto, r.since)
     group by r.user_id`,
    [offTypes, offPaths],
  );
  if (!due.length) return result;
  const title = await appTitle(ctx);
  const { send, close } = makeSender(creds);
  const providers = (p: PushProvider) => Boolean(creds[p]);
  try {
    for (const { user_id, newest } of due) {
      const count = (await ctx.db.one<{ c: number }>(
        `select count(*)::int as c from notifications n where n.user_id = $3 and n.in_app and n.dismissed_at is null and n.read_at is null and ${shown}`,
        [offTypes, offPaths, user_id],
      ))!.c;
      // Claim first: only the run that moves the cursor forward sends.
      const claimed = await ctx.db.one(
        `insert into push_cursor (user_id, pushed_upto, last_count) values ($1, $2::timestamptz, $3)
         on conflict (user_id) do update set pushed_upto = excluded.pushed_upto, last_count = excluded.last_count, updated_at = now()
           where push_cursor.pushed_upto < excluded.pushed_upto
         returning user_id`,
        [user_id, newest, count],
      );
      if (!claimed || count < 1) continue;
      result.people += 1;
      const r = await sendToPerson(ctx, user_id, { title, body: pushMessageText(count), count }, send, providers);
      result.sent += r.sent;
      result.failed += r.failed;
      result.removed += r.removed;
    }
  } finally {
    close();
  }
  return result;
}
