// E22-45: a webhook's address is kept encrypted, and the administrators' screen shows its host and a
// fingerprint only. The full address is shown to an administrator who confirmed their password, and
// each time it is shown is audited (the audit entry keeps the host and fingerprint, never the address).
import { secretBox } from '../../core/auth.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { openWebhookUrl, redactWebhookUrl } from '../../core/webhooks.ts';
import { sensitive } from '../admin/shared.ts';

export function registerWebhookReveal(ctx: ModuleContext) {
  const { app, db } = ctx;
  app.post('/api/admin/webhooks/:id/reveal', { preHandler: ctx.requirePerm('admin.administer') }, async (req) => {
    const id = String((req.params as Row).id ?? '');
    const hook = UUID_RE.test(id) ? await db.one<Row>('select id, name, url, url_sealed from webhooks where id = $1 and deleted_at is null', [id]) : undefined;
    if (!hook) return ctx.fail(404, 'not_found', 'Webhook not found.');
    await sensitive(ctx, req, `showing the address of webhook "${hook.name}"`);
    let url: string;
    try {
      url = openWebhookUrl(secretBox(db), hook as { id: string });
    } catch {
      return ctx.fail(409, 'unreadable', 'The address cannot be read with the current secret key. Enter it again.');
    }
    await ctx.audit(req, { action: 'webhook.reveal', recordType: 'webhook', recordId: hook.id, summary: `Address of webhook "${hook.name}" shown (${redactWebhookUrl(url)})` });
    return { url };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/admin/webhooks/:id/reveal', summary: 'Show a webhook\'s full address', permission: 'admin.administer', tag: 'Webhooks',
    response: '{ url }',
    description: 'Webhook addresses are kept encrypted and listed by host and fingerprint only (E22-45). Needs a recent password confirmation (403 `reauth_required`); each use is audited.',
  });
}
