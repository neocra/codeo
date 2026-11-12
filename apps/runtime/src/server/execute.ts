import { RuntimeError, type ClientMessage, type ServerMessage } from '@codeo/contracts';
import type { Logger } from '@codeo/shared-utils';
import type { CallContext, Runtime } from '../runtime';

type RequestMessage = Extract<ClientMessage, { kind: 'request' }>;
type ResponseMessage = Extract<ServerMessage, { kind: 'response' }>;

/** Runs one protocol request and builds its response frame; shared by the local server and the gateway relay. */
export async function executeRequest(runtime: Runtime, msg: RequestMessage, ctx: CallContext, log: Logger): Promise<ResponseMessage> {
  try {
    const result = await runtime.call(msg.command, msg.params, ctx);
    return { kind: 'response', id: msg.id, ok: true, result };
  } catch (err) {
    if (err instanceof RuntimeError) {
      return { kind: 'response', id: msg.id, ok: false, error: { code: err.code, message: err.message, details: err.details } };
    }
    log.error('command failed', { command: msg.command, err: err instanceof Error ? err.stack ?? err.message : String(err) });
    return { kind: 'response', id: msg.id, ok: false, error: { code: 'INTERNAL', message: err instanceof Error ? err.message : 'Erreur interne' } };
  }
}
