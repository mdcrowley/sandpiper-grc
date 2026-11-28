import type { ModuleContext } from '../../core/module.ts';
import { LOCAL_ROOTS_KEY } from '../attachments/local.ts';

/**
 * Settings for AI assistant access (MCP). All off until an administrator switches them on under
 * Administration > AI assistant access. They are not part of the general Settings screen, so a
 * personal access token can never change them (that screen's route is reachable with a token).
 */
export interface McpSettings {
  /** The /mcp endpoint answers at all. */
  enabled: boolean;
  /** Tools that create or change records are offered (to tokens that also carry write permissions). */
  writeEnabled: boolean;
  /** Tool names an administrator allows; null = every tool. */
  allowedTools: string[] | null;
  /** HTTP requests a minute to /mcp, per token (on top of the general token limit). */
  ratePerMinute: number;
  /** Browser origins allowed to call /mcp. Empty: any request carrying an Origin header is refused. */
  allowedOrigins: string[];
  /** Role keys whose holders may connect an assistant (E21-17); null = anyone holding a permission. */
  allowedRoles: string[] | null;
  /** Tools per role key (E21-19). A role without an entry is not limited. */
  roleTools: Record<string, string[]>;
  /** OAuth 2.1 sign-in for remote connectors (E21-16). */
  oauthEnabled: boolean;
  /** Connectors may register themselves (RFC 7591 dynamic client registration). */
  oauthRegistration: boolean;
  /** Connectors may use an https address of a client ID metadata document as their client_id (E21-21). */
  clientMetadata: boolean;
  /** Hosts such client ids may be on (host, host:port or *.domain); empty = any public host. */
  clientMetadataHosts: string[];
  /** A connector seen for the first time waits until an administrator approves it. */
  clientMetadataApproval: boolean;
  /**
   * Folders on the server's own disk an administrator's data load may read source files from (E18-96,
   * attachments/local.ts): absolute paths. Empty (the default) = local file import is off.
   */
  localImportRoots: string[];
}

export const KEYS = {
  enabled: 'mcp.enabled',
  writeEnabled: 'mcp.write_enabled',
  allowedTools: 'mcp.allowed_tools',
  ratePerMinute: 'mcp.rate_per_minute',
  allowedOrigins: 'mcp.allowed_origins',
  allowedRoles: 'mcp.allowed_roles',
  roleTools: 'mcp.role_tools',
  oauthEnabled: 'mcp.oauth_enabled',
  oauthRegistration: 'mcp.oauth_registration',
  clientMetadata: 'mcp.oauth_client_metadata',
  clientMetadataHosts: 'mcp.oauth_client_metadata_hosts',
  clientMetadataApproval: 'mcp.oauth_client_metadata_approval',
  localImportRoots: LOCAL_ROOTS_KEY,
} as const;

export const DEFAULTS: McpSettings = {
  enabled: false, writeEnabled: false, allowedTools: null, ratePerMinute: 120, allowedOrigins: [],
  allowedRoles: null, roleTools: {}, oauthEnabled: false, oauthRegistration: false,
  clientMetadata: false, clientMetadataHosts: [], clientMetadataApproval: false, localImportRoots: [],
};

const strings = (v: unknown) => (Array.isArray(v) ? v.map(String) : null);

export async function readSettings(ctx: ModuleContext): Promise<McpSettings> {
  const s = ctx.settings;
  const roleTools = await s.get<unknown>(KEYS.roleTools, {});
  return {
    enabled: (await s.get<unknown>(KEYS.enabled, false)) === true,
    writeEnabled: (await s.get<unknown>(KEYS.writeEnabled, false)) === true,
    allowedTools: strings(await s.get<unknown>(KEYS.allowedTools, null)),
    ratePerMinute: Math.max(1, Number(await s.get<unknown>(KEYS.ratePerMinute, DEFAULTS.ratePerMinute)) || DEFAULTS.ratePerMinute),
    allowedOrigins: strings(await s.get<unknown>(KEYS.allowedOrigins, [])) ?? [],
    allowedRoles: strings(await s.get<unknown>(KEYS.allowedRoles, null)),
    roleTools: roleTools && typeof roleTools === 'object' && !Array.isArray(roleTools)
      ? Object.fromEntries(Object.entries(roleTools as Record<string, unknown>).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).map(String)]))
      : {},
    oauthEnabled: (await s.get<unknown>(KEYS.oauthEnabled, false)) === true,
    oauthRegistration: (await s.get<unknown>(KEYS.oauthRegistration, false)) === true,
    clientMetadata: (await s.get<unknown>(KEYS.clientMetadata, false)) === true,
    clientMetadataHosts: strings(await s.get<unknown>(KEYS.clientMetadataHosts, [])) ?? [],
    clientMetadataApproval: (await s.get<unknown>(KEYS.clientMetadataApproval, false)) === true,
    localImportRoots: strings(await s.get<unknown>(KEYS.localImportRoots, [])) ?? [],
  };
}

/** The scope a token must carry to be accepted at /mcp. `*` alone is not enough: MCP use is chosen deliberately. */
export const MCP_SCOPE = 'mcp.use';
export const hasMcpScope = (scopes: string[]) => scopes.includes(MCP_SCOPE) || scopes.includes('mcp.*');

/** Whether a token's effective permissions include any way to create or change records. */
export const hasWriteScope = (permissions: string[]) =>
  permissions.some((p) => !p.startsWith('mcp.') && (p === '*' || /\.(\*|create|edit)$/.test(p)));

/** Who may connect an assistant (E21-17): someone holding a permission, in an allowed role when roles are chosen. */
export function mayConnect(settings: McpSettings, user: { roles: string[]; permissions: string[] }): boolean {
  if (!user.permissions.length) return false;
  return !settings.allowedRoles || user.roles.some((r) => settings.allowedRoles!.includes(r));
}

/**
 * The tools one caller may be offered by choice (E21-19), before permissions and write access:
 * the administrator's allowed list, narrowed by the caller's roles (the union of their roles'
 * lists; a role with no list does not narrow) and by the token's own list. null = no narrowing.
 */
export function chosenTools(settings: McpSettings, roles: string[], tokenTools: string[] | null): string[] | null {
  let out: Set<string> | null = settings.allowedTools ? new Set(settings.allowedTools) : null;
  const narrow = (names: string[]) => { out = out ? new Set([...out].filter((n) => names.includes(n))) : new Set(names); };
  if (roles.length && roles.every((r) => Array.isArray(settings.roleTools[r]))) narrow([...new Set(roles.flatMap((r) => settings.roleTools[r]))]);
  if (tokenTools) narrow(tokenTools);
  return out ? [...(out as Set<string>)].sort() : null;
}
