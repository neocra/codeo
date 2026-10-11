export type GatewayErrorCode =
  | 'INVALID_PARAMS'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL';

/** Error surfaced to HTTP clients as `{ error: { code, message } }` with the given status. */
export class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: GatewayErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export function toGatewayError(err: unknown): GatewayError {
  if (err instanceof GatewayError) return err;
  return new GatewayError(500, 'INTERNAL', 'internal error');
}

export function errorBody(err: GatewayError): { error: { code: GatewayErrorCode; message: string } } {
  return { error: { code: err.code, message: err.message } };
}
