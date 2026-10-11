import { z } from 'zod';
import { CommandNameSchema } from './commands';
import { RuntimeInfoSchema } from './commands';
import { SequencedEventSchema } from './events';

import { PROTOCOL_VERSION } from './version';

export { PROTOCOL_VERSION };

/* Client → Runtime */
export const ClientMessageSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('hello'),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    token: z.string().min(16),
    client: z.object({ name: z.string(), version: z.string(), kind: z.enum(['desktop', 'mobile', 'gateway', 'cli', 'test']) }),
    /** Replay events with seq > afterSeq; -1 disables replay (fresh client that will query state). */
    afterSeq: z.number().int().default(-1),
  }),
  z.object({
    kind: z.literal('request'),
    id: z.string().min(1),
    command: CommandNameSchema,
    params: z.unknown(),
  }),
  z.object({ kind: z.literal('ping'), t: z.number() }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const ErrorCodeSchema = z.enum([
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'INVALID_PARAMS',
  'NOT_FOUND',
  'CONFLICT',
  'PROVIDER_UNAVAILABLE',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/* Runtime → Client */
export const ServerMessageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('welcome'), runtime: RuntimeInfoSchema, lastSeq: z.number().int(), scopes: z.array(z.string()) }),
  /* One `response` member (zod 4 forbids duplicate discriminator values): `ok` tells which half applies. */
  z.object({
    kind: z.literal('response'),
    id: z.string(),
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z.object({ code: ErrorCodeSchema, message: z.string(), details: z.unknown().optional() }).optional(),
  }),
  z.object({ kind: z.literal('event'), seq: z.number().int(), event: SequencedEventSchema.shape.event }),
  z.object({ kind: z.literal('pong'), t: z.number() }),
  z.object({ kind: z.literal('error'), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export class RuntimeError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'RuntimeError';
  }
}

/** Stable identifier carried in `details` so clients can translate the error; `message` stays the French fallback. */
export interface LocalizedErrorDetails {
  key: string;
  params?: Record<string, string | number>;
}

export function localizedError(code: ErrorCode, key: string, params: Record<string, string | number> | undefined, message: string): RuntimeError {
  return new RuntimeError(code, message, { key, ...(params ? { params } : {}) } satisfies LocalizedErrorDetails);
}

export function localizedErrorDetails(details: unknown): LocalizedErrorDetails | null {
  if (!details || typeof details !== 'object' || typeof (details as { key?: unknown }).key !== 'string') return null;
  return details as LocalizedErrorDetails;
}
