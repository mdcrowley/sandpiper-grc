import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { captureConsole, createLogger, formatLogLine, lastLines, logRequests, logSettings, redact, redactPath, redactText, RotatingFile } from './logging.ts';

const scratch = mkdtempSync(join(tmpdir(), 'grc-logging-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const sink = () => {
  const lines: string[] = [];
  return { lines, out: { out: (l: string) => lines.push(`out:${l}`), err: (l: string) => lines.push(`err:${l}`) } };
};
const readLines = (path: string) => readFileSync(path, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

describe('server logging (E16-16)', () => {
  it('reads its settings from the environment and refuses nonsense', () => {
    const s = logSettings('/srv/data', {});
    expect(s).toMatchObject({ level: 'info', console: 'text', requests: true, files: 5, maxBytes: 10 * 1024 * 1024 });
    expect(s.dir).toMatch(/logs$/);
    expect(logSettings('memory', {}).dir).toBeNull();
    expect(logSettings('/srv/data', { GRC_LOG_DIR: 'off' }).dir).toBeNull();
    expect(logSettings('/srv/data', { GRC_LOG_LEVEL: 'DEBUG', GRC_LOG_CONSOLE: 'json', GRC_LOG_REQUESTS: 'off' })).toMatchObject({ level: 'debug', console: 'json', requests: false });
    expect(() => logSettings('/srv/data', { GRC_LOG_LEVEL: 'loud' })).toThrow(/GRC_LOG_LEVEL/);
    expect(() => logSettings('/srv/data', { GRC_LOG_MAX_MB: '-1' })).toThrow(/GRC_LOG_MAX_MB/);
  });

  it('never writes passwords, tokens, codes or connection passwords', () => {
    expect(redactText('Authorization: Bearer grc_pat_abc123XYZ')).not.toMatch(/abc123XYZ/);
    expect(redactText('connect postgres://grc:s3cret-pw@db:5432/grc failed')).toBe('connect postgres://grc:***@db:5432/grc failed');
    expect(redactText('login with password=hunter2&next=/')).toBe('login with password=***&next=***');
    const masked = redact({ username: 'dispatcher', password: 'hunter2', nested: { token: 'grc_pat_x', code: '123456', note: 'token: abc' }, status: 401 }) as any;
    expect(masked).toEqual({ username: 'dispatcher', password: '***', nested: { token: '***', code: '***', note: 'token: ***' }, status: 401 });
  });

  it('takes secrets out of paths: link tokens, long opaque segments and query values, but keeps record ids', () => {
    const token = 'Qx7_k2Lm9-ZpR4tVb8nWc1yHd3fGj6sAe0uIo5rTq2E'; // 43 characters, as a vendor response link
    expect(redactPath(`/api/vendor-response/${token}`)).toBe('/api/vendor-response/***');
    expect(redactPath(`/api/v1/vendor-response/${token}/files`)).toBe('/api/v1/vendor-response/***/files');
    expect(redactPath('/vendor-response/short-token')).toBe('/vendor-response/***');
    expect(redactPath(`/api/other/${'a'.repeat(40)}/x`)).toBe('/api/other/***/x');
    expect(redactPath('/api/tickets/3f2a9c1d-0b7e-4c55-9a1e-2d4b6f8a0c11')).toBe('/api/tickets/3f2a9c1d-0b7e-4c55-9a1e-2d4b6f8a0c11');
    expect(redactPath('/api/search?q=secret+words&page=2')).toBe('/api/search?q=***&page=***');
    // The same in any message, such as the error handler's "[error] GET <url>".
    expect(redactText(`[error] GET /api/vendor-response/${token}?step=2: failed`)).toBe('[error] GET /api/vendor-response/***?step=*** failed');
  });

  it('takes calendar feed addresses and the application\'s other tokens out (W17-3b)', () => {
    const feed = `grc_cal_${'M'.repeat(20)}-${'q'.repeat(22)}`;
    expect(redactPath(`/api/calendar/${feed}.ics`)).toBe('/api/calendar/***');
    expect(redactPath(`/api/v1/calendar/${feed}.ics`)).toBe('/api/v1/calendar/***');
    expect(JSON.stringify(redact({ path: `/api/calendar/${feed}.ics` }))).not.toContain(feed);
    // A long opaque segment followed by a file ending is masked too; short names and record ids are kept.
    expect(redactPath(`/api/other/${'b'.repeat(40)}.pdf`)).toBe('/api/other/***.pdf');
    expect(redactPath('/assets/index-3f2a9c1d.js')).toBe('/assets/index-3f2a9c1d.js');
    expect(redactPath('/api/tickets/3f2a9c1d-0b7e-4c55-9a1e-2d4b6f8a0c11.pdf')).toBe('/api/tickets/3f2a9c1d-0b7e-4c55-9a1e-2d4b6f8a0c11.pdf');
    for (const kind of ['cal', 'scim', 'relay', 'pat']) {
      expect(redactText(`refused grc_${kind}_AbC123xyz_-9 from 192.0.2.1`)).toBe(`refused grc_${kind}_*** from 192.0.2.1`);
    }
  });

  it('writes structured lines, honors the level, and rotates by size keeping the previous run', () => {
    const dir = join(scratch, 'rotate');
    writeFileSync(join(scratch, 'placeholder'), '');
    const { lines, out } = sink();
    const settings = { ...logSettings(dir, { GRC_LOG_DIR: dir, GRC_LOG_FILES: '2', GRC_LOG_MAX_MB: '0.01' }) };
    const first = createLogger(settings, out);
    first.info('first run', { console: true });
    first.debug('not at info level');
    first.error('it broke', { error: new Error('disk full, password=hunter2') });
    const entries = readLines(join(dir, 'grc.log'));
    expect(entries.map((e) => e.msg)).toEqual(['first run', 'it broke']);
    expect('console' in entries[0]).toBe(false);
    expect(entries[1].level).toBe('error');
    expect(JSON.stringify(entries[1])).not.toMatch(/hunter2/);
    expect(lines).toEqual(['out:first run', expect.stringMatching(/^err:\[error\] it broke\nError: disk full, password=\*\*\*/)]);

    // A restart keeps the previous run's log as grc.log.1.
    const second = createLogger(settings, sink().out);
    second.info('second run');
    expect(readLines(join(dir, 'grc.log.1')).map((e) => e.msg)).toContain('first run');
    // Past the size limit it rotates, keeping only GRC_LOG_FILES old files.
    for (let i = 0; i < 400; i++) second.info(`line ${i}`, { padding: 'x'.repeat(40) });
    expect(second.file!.rotated()).toEqual(['grc.log.1', 'grc.log.2']);
    expect(existsSync(join(dir, 'grc.log.3'))).toBe(false);
    expect(readFileSync(join(dir, 'grc.log')).length).toBeLessThanOrEqual(0.01 * 1024 * 1024);
  });

  it('routes the console through the logger', () => {
    const dir = join(scratch, 'console');
    const { lines, out } = sink();
    const logger = createLogger(logSettings(dir, { GRC_LOG_DIR: dir }), out);
    const restore = captureConsole(logger);
    try {
      console.log('module started');
      console.error('[jobs] failed', new Error('boom'));
    } finally {
      restore();
    }
    const entries = readLines(join(dir, 'grc.log'));
    expect(entries.map((e) => [e.level, e.msg])).toEqual([['info', 'module started'], ['error', '[jobs] failed boom']]);
    expect(entries[1].error.message).toBe('boom');
    expect(lines).toHaveLength(1); // only the error reaches the text console
  });

  it('logs one line per API request with its request id, without the query string', async () => {
    const dir = join(scratch, 'requests');
    const logger = createLogger(logSettings(dir, { GRC_LOG_DIR: dir, GRC_LOG_CONSOLE: 'off' }), sink().out);
    const server = createServer((req, res) => {
      if (req.url?.startsWith('/api/fail')) {
        res.writeHead(500, { 'x-request-id': 'req-500' }); // as the web framework does
        return res.end('{}');
      }
      res.setHeader('x-request-id', 'req-42');
      res.end('{}');
    });
    logRequests(server, logger);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      await fetch(`http://127.0.0.1:${port}/api/tickets?q=secret+words&token=abc`);
      await fetch(`http://127.0.0.1:${port}/api/fail`);
      await fetch(`http://127.0.0.1:${port}/assets/app.js`); // static files are not logged at info
      await fetch(`http://127.0.0.1:${port}/api/health`); // nor health checks
      await fetch(`http://127.0.0.1:${port}/api/vendor-response/Qx7_k2Lm9-ZpR4tVb8nWc1yHd3fGj6sAe0uIo5rTq2E`);
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      await new Promise((r) => server.close(r));
    }
    const entries = readLines(join(dir, 'grc.log'));
    expect(entries).toHaveLength(3);
    expect(entries[2].path).toBe('/api/vendor-response/***');
    expect(entries[0]).toMatchObject({ level: 'info', msg: 'request', reqId: 'req-42', method: 'GET', path: '/api/tickets', status: 200, ip: '127.0.0.1' });
    expect(entries[1]).toMatchObject({ level: 'error', reqId: 'req-500', path: '/api/fail', status: 500 });
    expect(JSON.stringify(entries)).not.toMatch(/secret|abc/);
  });

  it('shows the log readably for the logs command', () => {
    const file = join(scratch, 'tail.log');
    writeFileSync(file, Array.from({ length: 300 }, (_, i) => JSON.stringify({ time: '2030-01-31T09:00:00.000Z', level: 'info', msg: `line ${i}` })).join('\n') + '\n');
    expect(lastLines(file, 3).map((l) => JSON.parse(l).msg)).toEqual(['line 297', 'line 298', 'line 299']);
    expect(lastLines(join(scratch, 'missing.log'), 3)).toEqual([]);
    expect(formatLogLine(JSON.stringify({ time: 't', level: 'info', msg: 'request', method: 'GET', path: '/api/tickets', status: 200, ms: 12.5, ip: '127.0.0.1', reqId: 'r1' })))
      .toBe('t  200  GET    /api/tickets  12.5 ms  127.0.0.1  id r1');
    expect(formatLogLine(JSON.stringify({ time: 't', level: 'warn', msg: 'slow', table: 'tickets' }))).toBe('t  WARN  slow table=tickets');
    expect(formatLogLine('not json')).toBe('not json');
  });

  it('keeps the logs folder out of backups', async () => {
    const { isRuntimeFile } = await import('./backup.ts');
    expect(isRuntimeFile('logs')).toBe(true);
    expect(new RotatingFile(join(scratch, 'rf'), 1000, 1).path).toMatch(/grc\.log$/);
  });
});
