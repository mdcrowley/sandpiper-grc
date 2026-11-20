// The stored credentials of each mail provider, and a mailbox opened through a web interface for
// email to ticket (E14-25). The credentials are saved under Administration > Email and kept
// encrypted with the installation's secret key; email to ticket reuses them, so a secret is
// entered once.
import { secretBox } from '../auth.ts';
import type { Db } from '../db.ts';
import type { ModuleContext } from '../module.ts';
import { CloudError } from './cloud.ts';
import { gmailMailbox } from './gmail.ts';
import { graphMailbox, graphSettings } from './graph.ts';
import type { InboundMailbox } from './mailbox.ts';

export const SERVICE_PROVIDERS = ['graph', 'gmail'] as const;
export type ServiceProvider = typeof SERVICE_PROVIDERS[number];
export const PROVIDER_LABELS: Record<string, string> = { smtp: 'SMTP', graph: 'Microsoft Graph', gmail: 'Gmail API' };

/** The context a provider's credential is encrypted under ("mail:smtp" is the SMTP password). */
export const secretContext = (provider: string) => `mail:${provider}`;

interface StoredConfig { password_sealed: string | null; provider_secrets?: Record<string, string> | null; provider_settings?: Record<string, Record<string, unknown>> }

export function sealedSecret(config: StoredConfig, provider: string): string | null {
  if (provider === 'smtp') return config.password_sealed ?? null;
  const v = config.provider_secrets?.[provider];
  return typeof v === 'string' && v ? v : null;
}

/** The provider's decrypted credential, or null when none is saved. Throws when it cannot be decrypted. */
export function providerSecret(db: Db, config: StoredConfig, provider: string): string | null {
  const sealed = sealedSecret(config, provider);
  if (!sealed) return null;
  try {
    return secretBox(db).decrypt(sealed, secretContext(provider));
  } catch {
    throw new CloudError(`The stored ${PROVIDER_LABELS[provider] ?? provider} credential could not be decrypted (the secret key has changed). Enter it again under Administration > Email.`, false);
  }
}

async function stored(ctx: ModuleContext): Promise<StoredConfig | undefined> {
  try {
    return await ctx.db.one<StoredConfig>('select password_sealed, provider_secrets, provider_settings from mail_config where id = 1');
  } catch {
    return undefined; // email is not set up in this installation
  }
}

/** Which web-interface providers have a credential saved. */
export async function savedServiceAccounts(ctx: ModuleContext): Promise<Record<ServiceProvider, boolean>> {
  const c = await stored(ctx);
  const has = (p: ServiceProvider) => Boolean(c && sealedSecret(c, p) && (p !== 'graph' || (graphSettings(c).tenantId && graphSettings(c).clientId)));
  return { graph: has('graph'), gmail: has('gmail') };
}

/** Opens `mailbox` through Microsoft Graph or the Gmail API with the credential saved under Administration > Email. */
export async function openServiceMailbox(ctx: ModuleContext, provider: ServiceProvider, mailbox: string): Promise<InboundMailbox> {
  const c = await stored(ctx);
  const secret = c ? providerSecret(ctx.db, c, provider) : null;
  if (!c || !secret) throw new CloudError(`No ${PROVIDER_LABELS[provider]} sign-in is saved. Enter it under Administration > Email first.`, false);
  if (provider === 'graph') {
    const s = graphSettings(c);
    if (!s.tenantId || !s.clientId) throw new CloudError('Enter the tenant ID and client ID for Microsoft Graph under Administration > Email first.', false);
    return graphMailbox(s, secret, mailbox);
  }
  return gmailMailbox(secret, mailbox);
}
