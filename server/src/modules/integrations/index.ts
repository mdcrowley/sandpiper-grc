// Integrations (wave 11, GP-17 parts 1, 2 and 6): user provisioning over SCIM 2.0 (E36-01), audit-log
// forwarding to a security monitoring system (E36-02), and the webhook address reveal (E22-45).
// Always loaded (not a feature area); each connection is off until an administrator sets it up:
// provisioning needs `integrations.scim_enabled` and a token, forwarding needs outbound connections
// and a forwarder switched on, and both only reach the hosts an administrator allows.
import type { ModuleDef } from '../../core/module.ts';
import { ensureJobs, scheduleWork } from '../../core/jobs/index.ts';
import { makeForwarding } from './forwarding.ts';
import { registerForwardingAdmin } from './forwarding-admin.ts';
import { registerScim } from './scim.ts';
import { registerScimAdmin } from './scim-admin.ts';
import { registerWebhookReveal } from './webhook-reveal.ts';

const DAY = 86_400_000;

const mod: ModuleDef = {
  key: 'integrations',
  async register(ctx) {
    registerScim(ctx);
    registerScimAdmin(ctx);
    registerWebhookReveal(ctx);

    const forwarding = makeForwarding(ctx);
    registerForwardingAdmin(ctx, forwarding);
    // Every minute, in a lane of its own so a slow collector never holds up other work.
    const jobs = await ensureJobs(ctx);
    jobs.register('integrations.audit_forward', async () => forwarding.runAll(), { lane: 'integrations', maxAttempts: 3 });
    await jobs.schedule('integrations.audit_forward', { type: 'integrations.audit_forward', every: 60_000, firstRunInMs: 60_000 });
    // The forwarding delivery log is kept for `retention.audit_forward_log_days` (default 30).
    await scheduleWork(ctx, 'integrations.housekeeping', () => forwarding.housekeeping(), { every: DAY, firstRunInMs: 15 * 60_000 });
  },
};
export default mod;
