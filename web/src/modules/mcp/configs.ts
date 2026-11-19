// Ready-to-copy configuration for MCP clients. Kept apart from the pages so it can be tested.

export interface ConfigInput {
  /** The application's address, e.g. http://127.0.0.1:8080 (no trailing slash). */
  base: string;
  /** The token, or a placeholder when it is not on screen. */
  token: string;
  /** Where the person saved the bridge script. */
  bridgePath: string;
  /** Server name in the client. */
  name?: string;
}

export const TOKEN_PLACEHOLDER = '<your token>';
export const DEFAULT_BRIDGE_PATH = 'C:\\Tools\\sandpiper-mcp-stdio.mjs';

const json = (v: unknown) => JSON.stringify(v, null, 2);
/** A shell argument in double quotes (works the same in PowerShell, cmd and POSIX shells for these values). */
const q = (s: string) => `"${s.replace(/"/g, '')}"`;

/** Claude Desktop: claude_desktop_config.json, launching the stdio bridge. */
export function claudeDesktop(c: ConfigInput): string {
  return json({
    mcpServers: {
      [c.name ?? 'sandpiper']: { command: 'node', args: [c.bridgePath], env: { GRC_URL: c.base, GRC_TOKEN: c.token } },
    },
  });
}

/** Claude Code: the command line, over HTTP (preferred) or through the bridge. */
export function claudeCodeHttp(c: ConfigInput): string {
  return `claude mcp add --transport http ${c.name ?? 'sandpiper'} ${c.base}/mcp --header ${q(`Authorization: Bearer ${c.token}`)}`;
}
export function claudeCodeStdio(c: ConfigInput): string {
  return `claude mcp add ${c.name ?? 'sandpiper'} --env GRC_URL=${c.base} --env GRC_TOKEN=${c.token} -- node ${q(c.bridgePath)}`;
}

/** The common mcpServers shape: a remote server by address with a header. */
export function genericHttp(c: ConfigInput): string {
  return json({ mcpServers: { [c.name ?? 'sandpiper']: { url: `${c.base}/mcp`, headers: { Authorization: `Bearer ${c.token}` } } } });
}

/** The common mcpServers shape: a local command (the bridge). */
export function genericStdio(c: ConfigInput): string {
  return json({ mcpServers: { [c.name ?? 'sandpiper']: { command: 'node', args: [c.bridgePath], env: { GRC_URL: c.base, GRC_TOKEN: c.token } } } });
}

/** Remote connectors that sign in with OAuth (E21-16): only the address; no token is copied anywhere. */
export function connectorUrl(base: string): string {
  return `${base.replace(/\/+$/, '')}/mcp`;
}
export function claudeCodeOAuth(c: Pick<ConfigInput, 'base' | 'name'>): string {
  return `claude mcp add --transport http ${c.name ?? 'sandpiper'} ${connectorUrl(c.base)}`;
}
/** A remote connector over HTTPS with no header: the client finds the sign-in itself. */
export function genericOAuth(c: Pick<ConfigInput, 'base' | 'name'>): string {
  return json({ mcpServers: { [c.name ?? 'sandpiper']: { url: connectorUrl(c.base) } } });
}
