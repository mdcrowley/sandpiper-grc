// Delivery: tells each person's registered phones "You have N new notifications" once something new
// is in their notification list. What reaches the list follows each person's choices (notifications
// module): a kind they switched off, or chose to receive by email only, is not in the list and is
// never pushed; a switched-off area's notifications are neither listed nor pushed.
//
// Claimed per person: a run moves the person's cursor (push_cursor.pushed_upto) to their newest
// notification with a conditional upsert before sending, and only the run that moved it sends, so two
// runs at the same moment (two processes, or the hook's job and the sweep) send once.
//
// Retries (retry.ts): a phone whose service failed for a while only (unreachable, too slow, 5xx, 429)
// gets a waiting retry (push_registrations.retry_at). The run that clears retry_at with a conditional
// update sends it, so a retry is sent once however many runs see it; it says the person's count at the
// time it is sent, and nothing when everything has been read meanwhile. A phone with a retry waiting is
// left alone until then, even when something newer arrives (the retry will carry the newer count).
// Permanent rejections are never retried: a token the service no longer knows removes the
// registration, wrong credentials or a bad request are recorded (last_error) for the administrator.
import type { ModuleContext, Row } from '../../core/module.ts';
import { pushMessageText, type ApnsEnvironment, type PushProvider } from '../../../../shared/push-api.ts';
import { mobileOn, settleDisabled, settleSwitchedOff } from '../mobile/state.ts';
import { shownSql, switchedOffParams } from '../notifications/service.ts';
import { apnsClient } from './apns.ts';
import { anyOn, loadCredentials, targetContext, type PushCredentials } from './config.ts';
import { fcmClient } from './fcm.ts';
import { MAX_RETRY_AFTER_SECONDS, retryDelaySeconds } from './retry.ts';
import type { PushMessage, SendOutcome } from './types.ts';
import { unifiedPushClient, type WebPushTarget } from './webpush.ts';
import { secretBox } from '../../core/auth.ts';

/** What delivery needs of the module context (tests pass the app, its database and a settings reader). */
export type PushDeps = Pick<ModuleContext, 'db' | 'app' | 'settings'>;

export interface DeliveryResult {
  people: number;
  sent: number;
  failed: number;
  removed: number;
  /** Sends that failed for a while only and wait to be tried again. */
  retrying: number;
  /** Waiting retries this run made (whatever their outcome). */
  retried: number;
}

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

/** What one service's wait applies to: Apple, Firebase, or one UnifiedPush server. */
function serviceKey(provider: PushProvider, target: Target): string {
  if (provider !== 'unifiedpush') return provider;
  try {
    return `unifiedpush:${new URL((target as WebPushTarget).endpoint).host}`;
  } catch {
    return 'unifiedpush:';
  }
}

/**
 * The clients for one delivery run. When a service answers that it is unavailable or busy for every
 * phone (`pauseService`), the rest of the run does not call it: those phones get a retry after the
 * wait the service asked for (Retry-After), or after the usual back-off when it named none.
 */
export function makeSender(c: PushCredentials): { send: Sender; close: () => void } {
  const apns = c.apns ? apnsClient(c.apns) : null;
  const fcm = c.fcm ? fcmClient(c.fcm) : null;
  const up = c.unifiedpush ? unifiedPushClient(c.unifiedpush) : null;
  const paused = new Map<string, { until: number; message: string }>();
  const off = (what: string): SendOutcome => ({ ok: false, gone: false, message: `${what} is switched off on the server.` });
  const call = async (reg: Parameters<Sender>[0], m: PushMessage): Promise<SendOutcome> => {
    try {
      if (reg.provider === 'apns') return apns ? await apns.send((reg.target as { token: string }).token, reg.environment, m) : off('Apple push');
      if (reg.provider === 'fcm') return fcm ? await fcm.send((reg.target as { token: string }).token, m) : off('Firebase push');
      return up ? await up.send(reg.target as WebPushTarget, m) : off('UnifiedPush');
    } catch (err) {
      return { ok: false, gone: false, message: (err as Error).message.slice(0, 300) };
    }
  };
  return {
    async send(reg, m) {
      const key = serviceKey(reg.provider, reg.target);
      const pause = paused.get(key);
      if (pause && pause.until > Date.now()) {
        const left = Number.isFinite(pause.until) ? Math.ceil((pause.until - Date.now()) / 1000) : null;
        return { ok: false, gone: false, temporary: true, retryAfterSeconds: left, message: pause.message };
      }
      const res = await call(reg, m);
      if (!res.ok && res.temporary && res.pauseService) {
        const s = res.retryAfterSeconds;
        paused.set(key, { until: s === null || s === undefined ? Number.POSITIVE_INFINITY : Date.now() + s * 1000, message: res.message });
      }
      return res;
    },
    close: () => apns?.close(),
  };
}

interface RegRow {
  id: string;
  provider: PushProvider;
  environment: ApnsEnvironment;
  target_sealed: string;
  /** As text, so a claim compares the exact stored value (microseconds included). */
  retry_at: string | null;
  retry_attempts: number;
  /** A retry waits and is not due yet. */
  waiting: boolean;
}

const REG_COLUMNS = `r.id, r.provider, r.environment, r.target_sealed, r.retry_at::text as retry_at, r.retry_attempts,
  coalesce(r.retry_at > now(), false) as waiting`;

type OneResult = 'sent' | 'failed' | 'removed' | 'retrying' | 'waiting' | 'skipped';

/**
 * Sends one message to one registration and records the outcome. With `retries` (delivery), a waiting
 * retry is claimed first (only the run that clears it sends) and a temporary failure gets the next
 * retry; without (the administrator's test push), retry state is left as it is.
 */
async function sendOne(ctx: PushDeps, r: RegRow, m: PushMessage, sender: Sender, retries: boolean): Promise<OneResult> {
  if (retries && r.retry_at) {
    if (r.waiting) return 'waiting';
    const claimed = await ctx.db.one(
      'update push_registrations set retry_at = null where id = $1 and retry_at = $2::timestamptz returning id', [r.id, r.retry_at],
    );
    if (!claimed) return 'skipped';
  }
  let target: Target;
  try {
    target = JSON.parse(secretBox(ctx.db).decrypt(r.target_sealed, targetContext(r.id)));
  } catch {
    await ctx.db.query('delete from push_registrations where id = $1', [r.id]);
    return 'removed';
  }
  const res = await sender({ provider: r.provider, environment: r.environment, target }, m);
  if (res.ok) {
    await ctx.db.query(
      `update push_registrations set last_sent_at = now(), failures = 0, last_error = null, last_error_at = null
       ${retries ? ', retry_at = null, retry_attempts = 0' : ''} where id = $1`, [r.id],
    );
    return 'sent';
  }
  if (res.gone) {
    await ctx.db.query('delete from push_registrations where id = $1', [r.id]);
    return 'removed';
  }
  const message = res.message.slice(0, 400);
  if (retries && res.temporary) {
    const attempt = (r.retry_at ? r.retry_attempts : 0) + 1;
    const wait = retryDelaySeconds(attempt, res.retryAfterSeconds);
    if (wait !== null) {
      await ctx.db.query(
        `update push_registrations set failures = failures + 1, last_error = $2, last_error_at = now(),
           retry_at = now() + $3::int * interval '1 second', retry_attempts = $4 where id = $1`,
        [r.id, message, wait, attempt],
      );
      return 'retrying';
    }
    const why = (res.retryAfterSeconds ?? 0) > MAX_RETRY_AFTER_SECONDS
      ? `The service asked to wait more than ${MAX_RETRY_AFTER_SECONDS / 3600} hours; not tried again.`
      : `Not tried again after ${attempt} attempts.`;
    await ctx.db.query(
      `update push_registrations set failures = failures + 1, last_error = $2, last_error_at = now(), retry_at = null, retry_attempts = 0
       where id = $1`, [r.id, `${message} ${why}`.slice(0, 500)],
    );
    return 'failed';
  }
  await ctx.db.query(
    `update push_registrations set failures = failures + 1, last_error = $2, last_error_at = now()
     ${retries ? ', retry_at = null, retry_attempts = 0' : ''} where id = $1`, [r.id, message],
  );
  return 'failed';
}

const tally = (out: { sent: number; failed: number; removed: number; retrying: number }, r: OneResult) => {
  if (r === 'sent' || r === 'failed' || r === 'removed' || r === 'retrying') out[r] += 1;
};

/**
 * Sends to every registration of one person; records each outcome and removes the ones that are gone.
 * `retries`: delivery runs schedule retries for temporary failures; the test push does not.
 */
export async function sendToPerson(
  ctx: PushDeps, userId: string, m: PushMessage, sender: Sender, providers: (p: PushProvider) => boolean, opts: { retries?: boolean } = {},
) {
  const out = { sent: 0, failed: 0, removed: 0, retrying: 0 };
  const regs = await ctx.db.query<RegRow>(
    `select ${REG_COLUMNS} from push_registrations r
     join mobile_devices d on d.id = r.device_id and d.revoked_at is null and d.user_id = r.user_id
     where r.user_id = $1`, [userId],
  );
  for (const r of regs) {
    if (!providers(r.provider)) continue;
    tally(out, await sendOne(ctx, r, m, sender, Boolean(opts.retries)));
  }
  return out;
}

export async function appTitle(ctx: PushDeps): Promise<string> {
  return String(await ctx.settings.get('app.name', 'Sandpiper GRC')).slice(0, 60) || 'Sandpiper GRC';
}

/**
 * Queues a delivery run for when the next retry is due (the five-minute sweep would also find it,
 * later). The key is the run time rounded up to ten seconds, so the run doing this never blocks it.
 */
async function scheduleNextRetry(ctx: PushDeps): Promise<void> {
  if (!ctx.app.hasDecorator('jobs')) return;
  const next = await ctx.db.one<{ at: string | null }>('select min(retry_at)::text as at from push_registrations where retry_at is not null');
  if (!next?.at) return;
  const at = Math.ceil(Math.max(new Date(next.at).getTime(), Date.now() + 1000) / 10_000) * 10_000;
  await ctx.app.jobs.enqueue('push.deliver', {}, { key: `push.retry:${at}`, runAt: new Date(at) });
}

/**
 * One delivery run: everyone with a registered phone and a notification newer than their cursor is
 * told how many unread notifications they have; then every retry that is due is sent. Safe to run at
 * any time and in several processes.
 */
export async function deliverPending(ctx: PushDeps): Promise<DeliveryResult> {
  const result: DeliveryResult = { people: 0, sent: 0, failed: 0, removed: 0, retrying: 0, retried: 0 };
  if (!(await pushPossible(ctx))) return result;
  const creds = await loadCredentials(ctx.db);
  result.removed += await forgetSignedOut(ctx);
  if (!anyOn(creds)) return result;
  const [offTypes, offPaths] = switchedOffParams(ctx.app);
  const shown = shownSql(1, 2, 'n.');
  const unreadCount = async (userId: string) => (await ctx.db.one<{ c: number }>(
    `select count(*)::int as c from notifications n where n.user_id = $3 and n.in_app and n.dismissed_at is null and n.read_at is null and ${shown}`,
    [offTypes, offPaths, userId],
  ))!.c;
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
  const retriesDue = await ctx.db.query<RegRow & { user_id: string }>(
    `select ${REG_COLUMNS}, r.user_id from push_registrations r
     join mobile_devices d on d.id = r.device_id and d.revoked_at is null and d.user_id = r.user_id
     join users u on u.id = r.user_id and u.status = 'active' and u.deleted_at is null
     where r.retry_at is not null and r.retry_at <= now()
     order by r.user_id`,
  );
  if (!due.length && !retriesDue.length) return result;
  const title = await appTitle(ctx);
  const { send, close } = makeSender(creds);
  const providers = (p: PushProvider) => Boolean(creds[p]);
  try {
    for (const { user_id, newest } of due) {
      const count = await unreadCount(user_id);
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
      const r = await sendToPerson(ctx, user_id, { title, body: pushMessageText(count), count }, send, providers, { retries: true });
      result.sent += r.sent;
      result.failed += r.failed;
      result.removed += r.removed;
      result.retrying += r.retrying;
    }

    // Retries that are due (those sent above are no longer waiting: their claim cleared retry_at).
    const counts = new Map<string, number>();
    for (const r of retriesDue) {
      const clear = () => ctx.db.query(
        'update push_registrations set retry_at = null, retry_attempts = 0 where id = $1 and retry_at = $2::timestamptz', [r.id, r.retry_at],
      );
      if (!providers(r.provider)) { await clear(); continue; }
      if (!counts.has(r.user_id)) counts.set(r.user_id, await unreadCount(r.user_id));
      const count = counts.get(r.user_id)!;
      // Everything was read meanwhile: nothing to say.
      if (count < 1) { await clear(); continue; }
      const outcome = await sendOne(ctx, r, { title, body: pushMessageText(count), count }, send, true);
      if (outcome === 'skipped' || outcome === 'waiting') continue;
      result.retried += 1;
      tally(result, outcome);
    }
  } finally {
    close();
  }
  await scheduleNextRetry(ctx);
  return result;
}
