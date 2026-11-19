// A tiny POP3 server for tests: listens on a free port on 127.0.0.1 with messages held in
// memory. Plain connections only. Deletions take effect on QUIT, as on a real server.
import { createServer, type Server, type Socket } from 'node:net';

export interface FakePop3 {
  port: number;
  /** Messages still in the mailbox (raw RFC 5322 text). */
  messages: { uid: string; raw: string }[];
  add(raw: string, uid?: string): void;
  /** User name and password the server accepts. */
  credentials: { username: string; password: string };
  /** Sign-ins seen, for checking that the client authenticated. */
  logins: string[];
  close(): Promise<void>;
}

export async function startFakePop3(credentials = { username: 'desk', password: 'mailbox secret' }): Promise<FakePop3> {
  const messages: { uid: string; raw: string }[] = [];
  const logins: string[] = [];
  let n = 0;
  const sockets = new Set<Socket>();

  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let user = '';
    let authed = false;
    const doomed = new Set<number>();
    let pending = '';
    const reply = (s: string) => socket.write(`${s}\r\n`);
    const visible = () => messages.map((m, i) => ({ ...m, number: i + 1 })).filter((m) => !doomed.has(m.number));
    reply('+OK fake POP3 ready');
    socket.on('data', (chunk) => {
      pending += chunk.toString('latin1');
      let i: number;
      while ((i = pending.indexOf('\r\n')) >= 0) {
        const line = pending.slice(0, i);
        pending = pending.slice(i + 2);
        const [cmd, ...args] = line.split(' ');
        const arg = args.join(' ');
        switch (cmd.toUpperCase()) {
          case 'CAPA': reply('+OK'); socket.write('USER\r\nUIDL\r\n.\r\n'); break;
          case 'USER': user = arg; reply('+OK'); break;
          case 'PASS':
            if (user === credentials.username && arg === credentials.password) { authed = true; logins.push(user); reply('+OK signed in'); }
            else reply('-ERR authentication failed');
            break;
          case 'STAT': if (!authed) { reply('-ERR sign in first'); break; } reply(`+OK ${visible().length} ${visible().reduce((s, m) => s + m.raw.length, 0)}`); break;
          case 'LIST':
            if (!authed) { reply('-ERR sign in first'); break; }
            reply('+OK');
            socket.write(`${visible().map((m) => `${m.number} ${Buffer.byteLength(m.raw)}`).join('\r\n')}${visible().length ? '\r\n' : ''}.\r\n`);
            break;
          case 'UIDL':
            if (!authed) { reply('-ERR sign in first'); break; }
            reply('+OK');
            socket.write(`${visible().map((m) => `${m.number} ${m.uid}`).join('\r\n')}${visible().length ? '\r\n' : ''}.\r\n`);
            break;
          case 'RETR': {
            const m = visible().find((x) => x.number === Number(arg));
            if (!authed || !m) { reply('-ERR no such message'); break; }
            reply(`+OK ${Buffer.byteLength(m.raw)} octets`);
            const body = m.raw.replace(/\r?\n/g, '\r\n').replace(/(^|\r\n)\./g, '$1..');
            socket.write(`${body}${body.endsWith('\r\n') ? '' : '\r\n'}.\r\n`);
            break;
          }
          case 'DELE': if (!authed) { reply('-ERR sign in first'); break; } doomed.add(Number(arg)); reply('+OK deleted'); break;
          case 'NOOP': reply('+OK'); break;
          case 'QUIT': {
            const gone = [...doomed].sort((a, b) => b - a);
            for (const num of gone) messages.splice(num - 1, 1);
            reply('+OK bye');
            socket.end();
            break;
          }
          default: reply('-ERR unknown command');
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    port, messages, credentials, logins,
    add(raw, uid) { n += 1; messages.push({ uid: uid ?? `uid-${n}`, raw }); },
    close: () => new Promise<void>((resolve) => { for (const s of sockets) s.destroy(); server.close(() => resolve()); }),
  };
}
