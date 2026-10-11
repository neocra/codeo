import type { PermissionDecision, PermissionRequest } from '@codeo/agent-provider-core';
import { RuntimeError } from '@codeo/contracts';
import type { ApprovalRepo } from '@codeo/database';
import { approvalTransition, type AgentProviderId, type ApprovalRequest } from '@codeo/domain';
import { Deferred, newId, type Logger } from '@codeo/shared-utils';
import type { EventBus } from '../event-bus';

export const APPROVAL_TTL_MS = 15 * 60 * 1000;

interface Pending {
  approval: ApprovalRequest;
  decision: Deferred<PermissionDecision>;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Human approval checkpoints. A request is persisted immediately (so it is visible on
 * every client, and survives a crash as "expired"), then waits for exactly one decision.
 */
export class ApprovalService {
  private pending = new Map<string, Pending>();

  constructor(
    private readonly repo: ApprovalRepo,
    private readonly bus: EventBus,
    private readonly log: Logger,
  ) {}

  async init(): Promise<void> {
    /* Requests left pending by a previous run can no longer be honoured: expire them. */
    for (const a of await this.repo.list({ status: 'pending' })) {
      const expired = { ...a, status: 'expired' as const, resolvedAt: new Date().toISOString(), decidedBy: 'system' as const };
      await this.repo.upsert(expired);
      this.bus.publish('ApprovalResolved', { approval: expired });
    }
  }

  list(filter: { status?: ApprovalRequest['status'] | undefined; workspaceId?: string | undefined }): Promise<ApprovalRequest[]> {
    return this.repo.list(filter);
  }

  async request(ctx: { sessionId: string; taskId: string | null; workspaceId: string; provider: AgentProviderId }, req: PermissionRequest): Promise<PermissionDecision> {
    const now = Date.now();
    const approval: ApprovalRequest = {
      id: newId('apr'),
      sessionId: ctx.sessionId,
      taskId: ctx.taskId,
      workspaceId: ctx.workspaceId,
      provider: ctx.provider,
      providerRequestId: req.providerRequestId,
      tool: req.tool,
      input: req.input,
      summary: req.summary,
      affected: req.affected,
      risk: req.risk,
      reason: req.reason,
      status: 'pending',
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + APPROVAL_TTL_MS).toISOString(),
      resolvedAt: null,
      decidedBy: null,
    };
    await this.repo.upsert(approval);
    this.bus.publish('ApprovalRequested', { approval });

    const decision = new Deferred<PermissionDecision>();
    const timer = setTimeout(() => {
      void this.finish(approval.id, 'expired', 'system', { behavior: 'deny', message: 'Demande expirée sans décision humaine.' });
    }, APPROVAL_TTL_MS);
    this.pending.set(approval.id, { approval, decision, timer });

    req.signal.addEventListener(
      'abort',
      () => void this.finish(approval.id, 'cancelled', 'system', { behavior: 'deny', message: 'Exécution annulée.' }),
      { once: true },
    );
    return decision.promise;
  }

  private async finish(id: string, status: ApprovalRequest['status'], by: ApprovalRequest['decidedBy'], decision: PermissionDecision): Promise<ApprovalRequest | null> {
    const p = this.pending.get(id);
    if (!p) return null;
    this.pending.delete(id);
    clearTimeout(p.timer);
    const resolved: ApprovalRequest = { ...p.approval, status, resolvedAt: new Date().toISOString(), decidedBy: by };
    await this.repo.upsert(resolved);
    this.bus.publish('ApprovalResolved', { approval: resolved });
    p.decision.resolve(decision);
    return resolved;
  }

  /** The only path through which a human decision reaches the agent. Validates state + expiry. */
  async resolve(id: string, decision: 'approve' | 'reject', by: 'desktop' | 'mobile', reason?: string): Promise<ApprovalRequest> {
    const stored = this.pending.get(id)?.approval ?? (await this.repo.get(id));
    if (!stored) throw new RuntimeError('NOT_FOUND', 'Demande d’approbation introuvable.');
    const target = decision === 'approve' ? 'approved' : 'rejected';
    try {
      approvalTransition(stored, target);
    } catch (err) {
      throw new RuntimeError('CONFLICT', err instanceof Error ? err.message : String(err));
    }
    const result = await this.finish(
      id,
      target,
      by,
      decision === 'approve' ? { behavior: 'allow' } : { behavior: 'deny', message: reason ?? 'Refusé par l’utilisateur.' },
    );
    if (!result) throw new RuntimeError('CONFLICT', 'Cette demande n’est plus en attente (session terminée ?).');
    this.log.info('approval resolved', { id, decision, by });
    return result;
  }

  cancelForSession(sessionId: string): void {
    for (const [id, p] of this.pending) {
      if (p.approval.sessionId === sessionId) void this.finish(id, 'cancelled', 'system', { behavior: 'deny', message: 'Session arrêtée.' });
    }
  }

  shutdown(): void {
    for (const id of [...this.pending.keys()]) void this.finish(id, 'expired', 'system', { behavior: 'deny', message: 'Runtime arrêté.' });
  }
}
