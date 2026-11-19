import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { htmlToText, parseAddresses, parseMessage, stripQuoted } from './mime.ts';
import { startFakePop3, type FakePop3 } from './pop3-fake.ts';
import { Pop3 } from './pop3.ts';

// Invented addresses and text only.
const multipart = [
  'From: "Rivera, Sam" <Sam.Rivera@example.org>',
  'To: Service Desk <desk@example.org>, other@example.org',
  'Subject: =?utf-8?Q?Ticket_machine_at_Caf=C3=A9_stop?= =?utf-8?B?IGlzIGRvd24=?=',
  'Message-ID: <abc.123@mail.example.org>',
  'In-Reply-To: <first@mail.example.org>',
  'References: <zero@mail.example.org>',
  '  <first@mail.example.org>',
  'Date: Wed, 18 Nov 2026 09:15:00 -0500',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="outer"',
  '',
  'This is the preamble.',
  '--outer',
  'Content-Type: multipart/alternative; boundary=inner',
  '',
  '--inner',
  'Content-Type: text/plain; charset=iso-8859-1',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'The ticket machine shows an error. Fa=E7ade lights are off too.=',
  ' Thanks.',
  '--inner',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>The ticket machine shows an error.</p>',
  '--inner--',
  '--outer',
  'Content-Type: application/pdf; name="report.pdf"',
  'Content-Disposition: attachment; filename*=utf-8\'\'Fehler%20Bericht.pdf',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from('%PDF-1.4 invented').toString('base64'),
  '--outer--',
  'Epilogue to ignore.',
].join('\r\n');

describe('reading a message', () => {
  it('decodes headers, addresses, parts, character sets and attachment names', () => {
    const m = parseMessage(multipart);
    expect(m.from).toEqual({ address: 'sam.rivera@example.org', name: 'Rivera, Sam' });
    expect(m.to.map((a) => a.address)).toEqual(['desk@example.org', 'other@example.org']);
    expect(m.subject).toBe('Ticket machine at Café stop is down');
    expect(m.messageId).toBe('<abc.123@mail.example.org>');
    expect(m.inReplyTo).toEqual(['<first@mail.example.org>']);
    expect(m.references).toEqual(['<zero@mail.example.org>', '<first@mail.example.org>']);
    expect(m.date?.toISOString()).toBe('2026-11-18T14:15:00.000Z');
    expect(m.text).toBe('The ticket machine shows an error. Façade lights are off too. Thanks.');
    expect(m.html).toContain('<p>');
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments[0]).toMatchObject({ fileName: 'Fehler Bericht.pdf', contentType: 'application/pdf', inline: false });
    expect(m.attachments[0].content.toString()).toBe('%PDF-1.4 invented');
    expect(m.contentType).toBe('multipart/mixed');
  });

  it('makes text from an HTML-only message and keeps a plain message as it is', () => {
    const html = parseMessage('From: a@example.org\r\nContent-Type: text/html\r\n\r\n<div>Line one<br>Line &amp; two</div><script>x()</script>');
    expect(html.text).toBe('Line one\nLine & two');
    const plain = parseMessage('From: a@example.org\nSubject: Hi\n\nJust text.\n');
    expect(plain.text.trim()).toBe('Just text.');
    expect(plain.attachments).toEqual([]);
    expect(htmlToText('<a href="https://example.org/x">the page</a>')).toBe('the page (https://example.org/x)');
  });

  it('reads awkward address lists and keeps only the new part of a reply', () => {
    expect(parseAddresses('"Doe, Jo" <JO@Example.org>; plain@example.org, not-an-address').map((a) => a.address)).toEqual(['jo@example.org', 'plain@example.org']);
    const reply = 'Yes, it works now.\n\nOn Tue, 17 Nov 2026 at 10:00, Service Desk <desk@example.org> wrote:\n> Is it working?\n> Thanks';
    expect(stripQuoted(reply)).toBe('Yes, it works now.');
    expect(stripQuoted('Thanks\n-----Original Message-----\nFrom: desk')).toBe('Thanks');
    expect(stripQuoted('> only quoted')).toBe('> only quoted');
  });
});

describe('POP3 client against a fake server (no network)', () => {
  let server: FakePop3;
  beforeAll(async () => { server = await startFakePop3(); });
  afterAll(async () => { await server.close(); });

  it('signs in, lists, retrieves with dot-stuffing undone, and deletes on QUIT', async () => {
    server.add('Subject: one\r\n\r\nline\r\n.starts with a dot\r\n', 'u-1');
    server.add('Subject: two\r\n\r\nsecond\r\n', 'u-2');
    const box = await Pop3.connect({ host: '127.0.0.1', port: server.port, tls: 'none', username: 'desk', password: 'mailbox secret' });
    const list = await box.list();
    expect(list.map((m) => m.uid)).toEqual(['u-1', 'u-2']);
    const raw = (await box.retrieve(list[0].number)).toString();
    expect(raw).toContain('\r\n.starts with a dot');
    await box.delete(list[0].number);
    await box.quit();
    expect(server.messages.map((m) => m.uid)).toEqual(['u-2']);
    expect(server.logins).toEqual(['desk']);
  });

  it('reports a refused password as not worth retrying', async () => {
    await expect(Pop3.connect({ host: '127.0.0.1', port: server.port, tls: 'none', username: 'desk', password: 'wrong' }))
      .rejects.toMatchObject({ retryable: false });
  });
});
