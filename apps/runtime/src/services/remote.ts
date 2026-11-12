import { localizedError, RuntimeError, type PairedDevice, type RemotePairing, type RemoteStatus } from '@codeo/contracts';
import type { SettingsRepo } from '@codeo/database';
import type { Logger } from '@codeo/shared-utils';
import type { EventBus } from '../event-bus';
import { createGatewayApi, GatewayHttpError, relayUrl, type GatewayApi } from '../remote/gateway-api';
import { RelayClient, type RelayState } from '../remote/relay-client';
import type { Runtime } from '../runtime';

/** Persisted in the `settings` table. The secret never leaves the runtime (no command returns it). */
interface StoredRemote {
  enabled: boolean;
  gatewayUrl: string | null;
  runtimeId: string | null;
  runtimeSecret: string | null;
}

const SETTINGS_KEY = 'remote';
const EMPTY: StoredRemote = { enabled: false, gatewayUrl: null, runtimeId: null, runtimeSecret: null };

export interface RemoteServiceOptions {
  /** Builds the HTTP client for a gateway URL (tests inject one bound to an in-process gateway). */
  api?: (gatewayUrl: string) => GatewayApi;
  backoff?: { minMs: number; maxMs: number };
}

/**
 * Remote access through the Codeo gateway: registers this runtime once per gateway, keeps the outbound
 * relay connection alive while enabled, and brokers pairing and device revocation for the desktop.
 */
export class RemoteService {
  private stored: StoredRemote = EMPTY;
  private relay: RelayClient | null = null;
  private relayState: RelayState = { connection: 'offline', error: null };
  private connectedAt: string | null = null;
  private runtime: Pick<Runtime, 'info' | 'bus' | 'call'> | null = null;
  private readonly makeApi: (gatewayUrl: string) => GatewayApi;

  constructor(
    private readonly settings: SettingsRepo,
    private readonly bus: EventBus,
    private readonly log: Logger,
    private readonly machine: { name: string; platform: 'darwin' | 'win32' | 'linux' },
    private readonly opts: RemoteServiceOptions = {},
  ) {
    this.makeApi = opts.api ?? ((url) => createGatewayApi(url));
  }

  /** Loads the settings and reconnects when remote access was left on. */
  async init(runtime: Pick<Runtime, 'info' | 'bus' | 'call'>): Promise<void> {
    this.runtime = runtime;
    this.stored = { ...EMPTY, ...(await this.settings.get<Partial<StoredRemote>>(SETTINGS_KEY, {})) };
    if (this.stored.enabled && this.credentials()) this.startRelay();
  }

  status(): RemoteStatus {
    const enabled = this.stored.enabled;
    return {
      enabled,
      gatewayUrl: this.stored.gatewayUrl,
      runtimeId: this.stored.runtimeId,
      connection: enabled ? this.relayState.connection : 'disabled',
      connectedAt: enabled && this.relayState.connection === 'connected' ? this.connectedAt : null,
      lastError: enabled ? this.relayState.error : null,
    };
  }

  async enable(gatewayUrl: string): Promise<RemoteStatus> {
    const url = normalizeUrl(gatewayUrl);
    /* A new gateway, no registration yet, or a secret the gateway refused: register (again). */
    const mustRegister = url !== this.stored.gatewayUrl || !this.credentials() || this.relayState.connection === 'unauthorized';
    await this.stopRelay();
    if (mustRegister) {
      let reg;
      try {
        reg = await this.makeApi(url).register({ name: this.machine.name, platform: this.machine.platform });
      } catch (err) {
        throw this.toRuntimeError(err);
      }
      this.stored = { enabled: true, gatewayUrl: url, runtimeId: reg.runtimeId, runtimeSecret: reg.runtimeSecret };
      this.log.info('runtime registered with the gateway', { gateway: url, runtimeId: reg.runtimeId });
    } else {
      this.stored = { ...this.stored, enabled: true };
    }
    await this.settings.set(SETTINGS_KEY, this.stored);
    this.startRelay();
    return this.status();
  }

  /** Stops dialling out. The registration is kept, so paired phones work again once re-enabled. */
  async disable(): Promise<RemoteStatus> {
    await this.stopRelay();
    this.stored = { ...this.stored, enabled: false };
    await this.settings.set(SETTINGS_KEY, this.stored);
    this.publish();
    return this.status();
  }

  async startPairing(): Promise<RemotePairing> {
    const { api, secret } = this.requireEnabled();
    return this.guard(() => api.startPairing(secret));
  }

  async devices(): Promise<PairedDevice[]> {
    const { api, secret } = this.requireEnabled();
    return this.guard(() => api.listDevices(secret));
  }

  async revokeDevice(deviceId: string): Promise<{ deviceId: string; revoked: boolean }> {
    const { api, secret } = this.requireEnabled();
    return this.guard(() => api.revokeDevice(secret, deviceId));
  }

  async shutdown(): Promise<void> {
    await this.stopRelay();
  }

  private credentials(): { gatewayUrl: string; runtimeId: string; secret: string } | null {
    const { gatewayUrl, runtimeId, runtimeSecret } = this.stored;
    return gatewayUrl && runtimeId && runtimeSecret ? { gatewayUrl, runtimeId, secret: runtimeSecret } : null;
  }

  private requireEnabled(): { api: GatewayApi; secret: string } {
    const creds = this.credentials();
    if (!this.stored.enabled || !creds) {
      throw localizedError('CONFLICT', 'remote.disabled', undefined, 'Activez d’abord l’accès distant.');
    }
    return { api: this.makeApi(creds.gatewayUrl), secret: creds.secret };
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof GatewayHttpError && err.status === 401) {
        this.onRelayState({ connection: 'unauthorized', error: err.message });
        await this.stopRelay();
      }
      throw this.toRuntimeError(err);
    }
  }

  private toRuntimeError(err: unknown): RuntimeError {
    if (err instanceof RuntimeError) return err;
    if (err instanceof GatewayHttpError) {
      if (err.status === 401) return localizedError('UNAUTHENTICATED', 'remote.unauthorized', undefined, 'La passerelle ne reconnaît plus ce runtime : réactivez l’accès distant.');
      if (err.status === 404) return new RuntimeError('NOT_FOUND', err.message);
      if (err.status === 429) return localizedError('CONFLICT', 'remote.rateLimited', undefined, 'Trop de tentatives auprès de la passerelle, réessayez plus tard.');
      return new RuntimeError('PROVIDER_UNAVAILABLE', `Passerelle : ${err.message}`);
    }
    return new RuntimeError('INTERNAL', err instanceof Error ? err.message : String(err));
  }

  private startRelay(): void {
    const creds = this.credentials();
    if (!creds || !this.runtime) return;
    this.relay = new RelayClient({
      url: relayUrl(creds.gatewayUrl, creds.runtimeId),
      secret: creds.secret,
      runtime: this.runtime,
      log: this.log.child('relay'),
      onState: (s) => this.onRelayState(s),
      ...(this.opts.backoff ? { backoff: this.opts.backoff } : {}),
    });
    this.relay.start();
  }

  private async stopRelay(): Promise<void> {
    const relay = this.relay;
    this.relay = null;
    if (relay) await relay.stop();
  }

  private onRelayState(state: RelayState): void {
    const changed = state.connection !== this.relayState.connection || state.error !== this.relayState.error;
    if (state.connection === 'connected' && this.relayState.connection !== 'connected') this.connectedAt = new Date().toISOString();
    this.relayState = state;
    if (changed) this.publish();
  }

  private publish(): void {
    this.bus.publish('RemoteStatusChanged', { status: this.status() });
  }
}

/** Keeps the scheme, host, port and path prefix; drops the trailing slash, query and fragment. */
function normalizeUrl(raw: string): string {
  const u = new URL(raw);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new RuntimeError('INVALID_PARAMS', 'URL de passerelle invalide');
  /* The runtime secret travels in a header: plain HTTP only towards a gateway on this machine (development). */
  if (u.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) {
    throw localizedError('INVALID_PARAMS', 'remote.httpsRequired', undefined, 'La passerelle doit être en HTTPS (HTTP n’est accepté que pour localhost).');
  }
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
}
