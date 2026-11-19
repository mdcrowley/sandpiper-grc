import type { ModuleContext } from '../../core/module.ts';

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
}

export const KEYS = {
  enabled: 'mcp.enabled',
  writeEnabled: 'mcp.write_enabled',
  allowedTools: 'mcp.allowed_tools',
  ratePerMinute: 'mcp.rate_per_minute',
  allowedOrigins: 'mcp.allowed_origins',
} as const;

export const DEFAULTS: McpSettings = { enabled: false, writeEnabled: false, allowedTools: null, ratePerMinute: 120, allowedOrigins: [] };

export async function readSettings(ctx: ModuleContext): Promise<McpSettings> {
  const s = ctx.settings;
  const tools = await s.get<unknown>(KEYS.allowedTools, null);
  const origins = await s.get<unknown>(KEYS.allowedOrigins, []);
  return {
    enabled: (await s.get<unknown>(KEYS.enabled, false)) === true,
    writeEnabled: (await s.get<unknown>(KEYS.writeEnabled, false)) === true,
    allowedTools: Array.isArray(tools) ? tools.map(String) : null,
    ratePerMinute: Math.max(1, Number(await s.get<unknown>(KEYS.ratePerMinute, DEFAULTS.ratePerMinute)) || DEFAULTS.ratePerMinute),
    allowedOrigins: Array.isArray(origins) ? origins.map(String) : [],
  };
}

/** The scope a token must carry to be accepted at /mcp. `*` alone is not enough: MCP use is chosen deliberately. */
export const MCP_SCOPE = 'mcp.use';
export const hasMcpScope = (scopes: string[]) => scopes.includes(MCP_SCOPE) || scopes.includes('mcp.*');

/** Whether a token's effective permissions include any way to create or change records. */
export const hasWriteScope = (permissions: string[]) =>
  permissions.some((p) => !p.startsWith('mcp.') && (p === '*' || /\.(\*|create|edit)$/.test(p)));
