import { PairedDeviceSchema, RemotePairingSchema, RuntimeError, type PairedDevice, type RemotePairing } from '@codeo/contracts';
import { z } from 'zod';

/*
 * HTTP side of the Codeo gateway, as seen by a runtime (see docs/security/remote-access.md §3–4).
 * The runtime secret only ever travels in the `Authorization: Bearer` header; every response is
 * validated with zod before it is used.
 */

const RegisterResponseSchema = z.object({
  runtimeId: z.string().min(3),
  runtimeSecret: z.string().min(16),
  ownerAccountId: z.string(),
  createdAt: z.string(),
});
export type GatewayRegistration = z.infer<typeof RegisterResponseSchema>;

const ErrorBodySchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/** The gateway answered with a status that tells something about our credentials or input. */
export class GatewayHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface GatewayApi {
  register(input: { name: string; platform: 'darwin' | 'win32' | 'linux' }): Promise<GatewayRegistration>;
  startPairing(secret: string): Promise<RemotePairing>;
  listDevices(secret: string): Promise<PairedDevice[]>;
  revokeDevice(secret: string, deviceId: string): Promise<{ deviceId: string; revoked: boolean }>;
}

/** `https://gw.example` → `wss://gw.example/v1/runtimes/<id>/connect` (http → ws for local development). */
export function relayUrl(gatewayUrl: string, runtimeId: string): string {
  const u = new URL(gatewayUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = `${u.pathname.replace(/\/+$/, '')}/v1/runtimes/${encodeURIComponent(runtimeId)}/connect`;
  u.search = '';
  u.hash = '';
  return u.toString();
}

export function createGatewayApi(gatewayUrl: string, fetchImpl: typeof fetch = fetch): GatewayApi {
  const base = gatewayUrl.replace(/\/+$/, '');

  async function call<S extends z.ZodType>(method: 'GET' | 'POST', path: string, schema: S, opts: { secret?: string; body?: unknown } = {}): Promise<z.output<S>> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (opts.secret) headers['authorization'] = `Bearer ${opts.secret}`;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers,
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new RuntimeError('PROVIDER_UNAVAILABLE', `Passerelle injoignable (${base}) : ${err instanceof Error ? err.message : String(err)}`);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* handled below */
    }
    if (!res.ok) {
      const parsed = ErrorBodySchema.safeParse(json);
      throw new GatewayHttpError(res.status, parsed.success ? parsed.data.error.code : 'HTTP', parsed.success ? parsed.data.error.message : `HTTP ${res.status}`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new RuntimeError('INTERNAL', `Réponse inattendue de la passerelle pour ${path}`);
    return parsed.data;
  }

  return {
    register: (input) => call('POST', '/v1/runtimes/register', RegisterResponseSchema, { body: input }),
    startPairing: (secret) => call('POST', '/v1/pairing/start', RemotePairingSchema, { secret }),
    listDevices: async (secret) => (await call('GET', '/v1/devices', z.object({ devices: z.array(PairedDeviceSchema) }), { secret })).devices,
    revokeDevice: (secret, deviceId) =>
      call('POST', `/v1/devices/${encodeURIComponent(deviceId)}/revoke`, z.object({ deviceId: z.string(), revoked: z.boolean() }), { secret }),
  };
}
