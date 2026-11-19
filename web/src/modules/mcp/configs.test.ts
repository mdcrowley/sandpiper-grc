import { describe, expect, it } from 'vitest';
import { claudeCodeHttp, claudeCodeOAuth, claudeCodeStdio, claudeDesktop, connectorUrl, genericHttp, genericOAuth, genericStdio } from './configs';

const c = { base: 'http://127.0.0.1:8080', token: 'grc_pat_abc', bridgePath: 'C:\\Tools\\sandpiper-mcp-stdio.mjs' };

describe('client configuration', () => {
  it('builds the mcpServers JSON for a local command and for HTTP', () => {
    expect(JSON.parse(claudeDesktop(c))).toEqual({
      mcpServers: { sandpiper: { command: 'node', args: ['C:\\Tools\\sandpiper-mcp-stdio.mjs'], env: { GRC_URL: 'http://127.0.0.1:8080', GRC_TOKEN: 'grc_pat_abc' } } },
    });
    expect(JSON.parse(genericStdio(c))).toEqual(JSON.parse(claudeDesktop(c)));
    expect(JSON.parse(genericHttp(c))).toEqual({
      mcpServers: { sandpiper: { url: 'http://127.0.0.1:8080/mcp', headers: { Authorization: 'Bearer grc_pat_abc' } } },
    });
  });

  it('builds the command lines, keeping Windows paths as they are', () => {
    expect(claudeCodeHttp(c)).toBe('claude mcp add --transport http sandpiper http://127.0.0.1:8080/mcp --header "Authorization: Bearer grc_pat_abc"');
    expect(claudeCodeStdio(c)).toBe('claude mcp add sandpiper --env GRC_URL=http://127.0.0.1:8080 --env GRC_TOKEN=grc_pat_abc -- node "C:\\Tools\\sandpiper-mcp-stdio.mjs"');
  });
});

describe('remote connectors (OAuth)', () => {
  it('gives only the address, never a token', () => {
    expect(connectorUrl('https://grc.example.org/')).toBe('https://grc.example.org/mcp');
    expect(claudeCodeOAuth({ base: 'https://grc.example.org' })).toBe('claude mcp add --transport http sandpiper https://grc.example.org/mcp');
    expect(JSON.parse(genericOAuth({ base: 'https://grc.example.org' }))).toEqual({ mcpServers: { sandpiper: { url: 'https://grc.example.org/mcp' } } });
  });
});
