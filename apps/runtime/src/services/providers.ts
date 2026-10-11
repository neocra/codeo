import type { AgentProvider } from '@codeo/agent-provider-core';
import { ProviderUnavailableError } from '@codeo/agent-provider-core';
import type { AgentProviderId, ProviderStatus } from '@codeo/domain';
import type { Logger } from '@codeo/shared-utils';
import type { EventBus } from '../event-bus';

export class ProviderRegistry {
  private statuses = new Map<AgentProviderId, ProviderStatus>();
  private detecting: Promise<ProviderStatus[]> | null = null;

  constructor(
    private readonly providers: AgentProvider[],
    private readonly bus: EventBus,
    private readonly log: Logger,
  ) {}

  get(id: AgentProviderId): AgentProvider {
    const p = this.providers.find((x) => x.id === id);
    if (!p) throw new ProviderUnavailableError(id, `Fournisseur inconnu: ${id}`);
    return p;
  }

  status(id: AgentProviderId): ProviderStatus | undefined {
    return this.statuses.get(id);
  }

  list(): ProviderStatus[] {
    return this.providers.map((p) => this.statuses.get(p.id)).filter((s): s is ProviderStatus => Boolean(s));
  }

  /** Runs real detection for every provider (installation, version, auth) and publishes the result. */
  async detectAll(): Promise<ProviderStatus[]> {
    if (this.detecting) return this.detecting;
    this.detecting = (async () => {
      const results = await Promise.all(
        this.providers.map(async (p) => {
          try {
            return await p.detect();
          } catch (err) {
            this.log.warn('provider detection failed', { provider: p.id, err: String(err) });
            const prev = this.statuses.get(p.id);
            return {
              ...(prev ?? emptyStatus(p)),
              installed: false,
              error: err instanceof Error ? err.message : String(err),
              checkedAt: new Date().toISOString(),
            };
          }
        }),
      );
      for (const s of results) this.statuses.set(s.provider, s);
      this.bus.publish('ProvidersChanged', { providers: results });
      return results;
    })();
    try {
      return await this.detecting;
    } finally {
      this.detecting = null;
    }
  }
}

function emptyStatus(p: AgentProvider): ProviderStatus {
  return {
    provider: p.id,
    displayName: p.displayName,
    installed: false,
    version: null,
    executable: null,
    authenticated: 'unknown',
    authDetail: null,
    capabilities: { streaming: false, resume: false, interrupt: false, permissionRequests: false, modelSelection: false, toolCalls: false, structuredOutput: false, worktreeAware: false },
    models: [],
    modes: [],
    error: null,
    checkedAt: new Date().toISOString(),
  };
}
