import { createServer, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { ClientMessageSchema, RuntimeError, type CommandScope, type ServerMessage } from '@codeo/contracts';
import { redactSecrets, type Logger } from '@codeo/shared-utils';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Runtime } from '../runtime';

export interface ServerOptions {
  runtime: Runtime;
  token: string;
  host?: string;
  port?: number;
  logger: Logger;
}

export interface RuntimeServer {
  port: number;
  host: string;
  close(): Promise<void>;
}

const ALL_SCOPES: CommandScope[] = ['read', 'session:write', 'approval:decide', 'workspace:admin'];

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Local WebSocket transport for the runtime protocol. Binds to loopback by default; every
 * connection must authenticate with the runtime token before any command is accepted.
 */
export async function startServer(opts: ServerOptions): Promise<RuntimeServer> {
  const host = opts.host ?? '127.0.0.1';
  const http: Server = createServer((_, res) => {
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ server: http, maxPayload: 4 * 1024 * 1024 });
  const log = opts.logger;

  wss.on('connection', (ws: WebSocket, req) => {
    let authenticated = false;
    let scopes: CommandScope[] = [];
    let clientKind: 'desktop' | 'mobile' | 'gateway' | 'cli' | 'test' = 'desktop';
    const send = (m: ServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(redactSecrets(JSON.stringify(m)));
    };
    const authTimer = setTimeout(() => {
      if (!authenticated) ws.close(4001, 'authentication timeout');
    }, 5000);
    const unsubscribe = opts.runtime.bus.on('event', ({ seq, event }) => {
      if (authenticated) send({ kind: 'event', seq, event });
    });

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = ClientMessageSchema.parse(JSON.parse(String(raw)));
      } catch {
        send({ kind: 'error', message: 'Message invalide' });
        return;
      }
      if (msg.kind === 'hello') {
        if (!safeEqual(msg.token, opts.token)) {
          send({ kind: 'error', message: 'Jeton invalide' });
          ws.close(4003, 'unauthorized');
          return;
        }
        authenticated = true;
        clearTimeout(authTimer);
        clientKind = msg.client.kind;
        /* Local clients get every scope; the gateway narrows scopes per paired device (phase 6). */
        scopes = clientKind === 'mobile' ? ['read', 'session:write', 'approval:decide'] : ALL_SCOPES;
        send({ kind: 'welcome', runtime: opts.runtime.info, lastSeq: opts.runtime.bus.lastSeq, scopes });
        if (msg.afterSeq >= 0 && msg.afterSeq < opts.runtime.bus.lastSeq) {
          const missed = await opts.runtime.bus.replay(msg.afterSeq);
          for (const m of missed) send({ kind: 'event', seq: m.seq, event: m.payload as never });
        }
        log.info('client connected', { kind: clientKind, name: msg.client.name, ip: req.socket.remoteAddress });
        return;
      }
      if (!authenticated) {
        send({ kind: 'error', message: 'Non authentifié' });
        return;
      }
      if (msg.kind === 'ping') {
        send({ kind: 'pong', t: msg.t });
        return;
      }
      try {
        const result = await opts.runtime.call(msg.command, msg.params, { scopes, clientKind });
        send({ kind: 'response', id: msg.id, ok: true, result });
      } catch (err) {
        if (err instanceof RuntimeError) {
          send({ kind: 'response', id: msg.id, ok: false, error: { code: err.code, message: err.message, details: err.details } });
        } else {
          log.error('command failed', { command: msg.command, err: err instanceof Error ? err.stack ?? err.message : String(err) });
          send({ kind: 'response', id: msg.id, ok: false, error: { code: 'INTERNAL', message: err instanceof Error ? err.message : 'Erreur interne' } });
        }
      }
    });
    ws.on('close', () => {
      clearTimeout(authTimer);
      unsubscribe();
    });
  });

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(opts.port ?? 0, host, () => resolve());
  });
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : opts.port ?? 0;
  log.info('runtime listening', { host, port });
  return {
    port,
    host,
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of wss.clients) c.close(1001, 'shutdown');
        wss.close(() => http.close(() => resolve()));
      }),
  };
}
