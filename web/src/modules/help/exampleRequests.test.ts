import { describe, expect, it } from 'vitest';
import { exampleValue, examples } from './exampleRequests';

// The copyable request examples of the API reference (/help/api).

const schemas = {
  TicketInput: {
    type: 'object', required: ['title'],
    properties: {
      title: { type: ['string', 'null'] },
      priority: { type: ['string', 'null'], enum: ['high', 'low', null] },
      due_at: { type: ['string', 'null'], format: 'date-time' },
      ref: { type: 'string', readOnly: true },
    },
  },
};

describe('API reference examples', () => {
  it('makes a small example body from a schema: required members first, read-only ones left out', () => {
    expect(exampleValue({ $ref: '#/components/schemas/TicketInput' }, schemas)).toEqual({ title: 'text', priority: 'high' });
    expect(exampleValue({ type: 'array', items: { type: 'string', format: 'uuid' } }, schemas)).toEqual(['00000000-0000-0000-0000-000000000000']);
    expect(exampleValue({ type: 'integer', default: 50 }, schemas)).toBe(50);
  });

  it('writes curl and PowerShell commands with a token placeholder and never a real token', () => {
    const op = { requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/TicketInput' } } } } };
    const { curl, powershell } = examples('post', '/api/v1/tickets', op, schemas, 'https://grc.example.test');
    expect(curl).toBe([
      'curl -X POST "https://grc.example.test/api/v1/tickets"',
      '  -H "Authorization: Bearer $GRC_TOKEN"',
      '  -H "Content-Type: application/json"',
      '  -d \'{"title":"text","priority":"high"}\'',
    ].join(' \\\n'));
    expect(powershell).toContain('$headers = @{ Authorization = "Bearer $env:GRC_TOKEN" }');
    expect(powershell).toContain('Invoke-RestMethod -Method Post -Uri "https://grc.example.test/api/v1/tickets"');
    expect(powershell).toContain('-Body \'{"title":"text","priority":"high"}\'');
  });

  it('adds required query parameters, and no token for a public route', () => {
    const { curl, powershell } = examples('get', '/api/v1/health', { security: [], parameters: [{ name: 'q', in: 'query', required: true }] }, schemas, 'http://127.0.0.1:8080');
    expect(curl).toBe('curl -X GET "http://127.0.0.1:8080/api/v1/health?q=<q>"');
    expect(powershell).toBe('Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:8080/api/v1/health?q=<q>"');
  });

  it('quotes a body with an apostrophe safely for each shell', () => {
    const op = { requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { note: { type: 'string', const: "driver's log" } } } } } } };
    const { curl, powershell } = examples('post', '/api/v1/x', op, undefined, '');
    expect(curl).toContain(`-d '{"note":"driver'\\''s log"}'`);
    expect(powershell).toContain(`-Body '{"note":"driver''s log"}'`);
  });
});
