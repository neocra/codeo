import { classifyToolUse, type AgentProvider, type ProviderSessionHandle, type StartSessionOptions } from '@codeo/agent-provider-core';
import type { AgentProviderId, ProviderStatus } from '@codeo/domain';
import { newId } from '@codeo/shared-utils';

export const DEMO_VERSION = 'demo';

const DISPLAY: Record<AgentProviderId, string> = { 'claude-code': 'Claude Code', codex: 'Codex' };
const MODELS: Record<AgentProviderId, string> = { 'claude-code': 'demo-claude', codex: 'demo-codex' };

/** The fictional file a scripted turn proposes to change, chosen from the demo repository. */
function demoFile(cwd: string): { read: string; edit: string } {
  if (cwd.includes('elyndor-backend')) return { read: 'src/matchmaking/lobby.go', edit: 'src/matchmaking/lobby.go' };
  if (cwd.includes('elyndor')) return { read: 'Assets/Scripts/Inventory/InventoryGrid.cs', edit: 'Assets/Scripts/Inventory/InventoryGrid.cs' };
  return { read: 'apps/api/src/routes/invoices.ts', edit: 'apps/api/src/routes/invoices.ts' };
}

/**
 * Scripted agent used only by a runtime started in demo mode. It never spawns a process,
 * never touches the file system and never contacts a model: it replays a short, plausible
 * turn (streamed text, a read, one change that goes through a real Codeo approval) so the
 * product can be shown without a real install. Its status says so explicitly.
 */
export class DemoProvider implements AgentProvider {
  readonly displayName: string;

  constructor(
    readonly id: AgentProviderId,
    /** Delay between scripted steps; 0 in tests. */
    private readonly stepMs = 350,
  ) {
    this.displayName = `${DISPLAY[id]} (démo)`;
  }

  async detect(): Promise<ProviderStatus> {
    return {
      provider: this.id,
      displayName: this.displayName,
      installed: true,
      version: DEMO_VERSION,
      executable: null,
      authenticated: 'unknown',
      authDetail: 'Agent simulé du mode démo : aucun agent réel n’est exécuté.',
      capabilities: { streaming: true, resume: true, interrupt: true, permissionRequests: true, modelSelection: false, toolCalls: true, structuredOutput: false, worktreeAware: false },
      models: [{ id: MODELS[this.id], displayName: `${DISPLAY[this.id]} démo`, description: 'Réponses scriptées, aucun modèle appelé.' }],
      modes: [],
      error: null,
      checkedAt: new Date().toISOString(),
    };
  }

  async startSession(opts: StartSessionOptions): Promise<ProviderSessionHandle> {
    let providerSessionId = opts.resumeProviderSessionId;
    let abort = new AbortController();
    let closed = false;
    const files = demoFile(opts.cwd);

    const wait = (signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        if (signal.aborted) return reject(new Error('aborted'));
        const timer = setTimeout(resolve, this.stepMs);
        signal.addEventListener('abort', () => (clearTimeout(timer), reject(new Error('aborted'))), { once: true });
      });

    const stream = async (signal: AbortSignal, blockId: string, text: string) => {
      const words = text.split(/(?<= )/);
      for (const w of words) {
        opts.onEvent({ type: 'text_delta', blockId, delta: w });
        if (this.stepMs) await new Promise((r) => setTimeout(r, Math.min(40, this.stepMs / 8)));
        if (signal.aborted) throw new Error('aborted');
      }
      opts.onEvent({ type: 'text_complete', blockId, text });
    };

    const runTurn = async (prompt: string, signal: AbortSignal) => {
      const started = Date.now();
      providerSessionId ??= newId('demo');
      opts.onEvent({ type: 'session_started', providerSessionId, model: opts.model ?? MODELS[this.id] });
      opts.onEvent({ type: 'status', state: 'running' });
      const subject = prompt.split('\n').find((l) => l.startsWith('Tâche:'))?.replace('Tâche:', '').trim() ?? prompt.split('\n')[0]!.slice(0, 80);
      await wait(signal);
      await stream(signal, newId('blk'), `(Démo) Je regarde le code concerné par « ${subject} ».`);

      const readId = newId('tu');
      opts.onEvent({ type: 'tool_call_started', toolUseId: readId, tool: 'Read', input: { file_path: files.read } });
      await wait(signal);
      opts.onEvent({ type: 'tool_call_completed', toolUseId: readId, output: '(contenu fictif — mode démo)', isError: false });

      await stream(signal, newId('blk'), `Je modifie \`${files.edit}\`${opts.executionMode === 'manual' ? ' : cette modification demande votre accord.' : '.'}`);
      const editId = newId('tu');
      const input = { file_path: files.edit };
      const c = classifyToolUse('Edit', input);
      /* Like the real adapters, only `manual` escalates each change to a human. */
      const decision =
        opts.executionMode === 'manual'
          ? await opts.onPermissionRequest({ providerRequestId: editId, tool: 'Edit', input, summary: c.summary, affected: c.affected, risk: c.risk, reason: 'Mode démo : rien ne sera écrit sur le disque.', signal })
          : ({ behavior: 'allow' } as const);
      if (signal.aborted) throw new Error('aborted');
      opts.onEvent({ type: 'tool_call_started', toolUseId: editId, tool: 'Edit', input });
      let summary: string;
      if (decision.behavior === 'allow') {
        await wait(signal);
        opts.onEvent({ type: 'tool_call_completed', toolUseId: editId, output: '(modification simulée — aucun fichier écrit)', isError: false });
        summary = `(Démo) Modification simulée de ${files.edit}. Tests simulés : 12 passés. À relire avant de continuer.`;
      } else {
        opts.onEvent({ type: 'tool_call_denied', toolUseId: editId, reason: decision.message });
        summary = '(Démo) Modification refusée : je n’ai rien changé. Dites-moi comment poursuivre.';
      }
      await stream(signal, newId('blk'), summary);
      opts.onEvent({ type: 'turn_completed', ok: true, summary, durationMs: Date.now() - started, costUsd: 0, turns: 1 });
    };

    return {
      get providerSessionId() {
        return providerSessionId;
      },
      send: async (text) => {
        if (closed) throw new Error('Session démo fermée.');
        abort = new AbortController();
        const signal = abort.signal;
        /* Like the real adapters: accept the turn now, run it asynchronously. */
        void runTurn(text, signal).catch((err: unknown) => {
          if (signal.aborted) return;
          opts.onEvent({ type: 'error', message: err instanceof Error ? err.message : String(err), fatal: false });
        });
      },
      interrupt: async () => {
        abort.abort();
      },
      close: async () => {
        closed = true;
        abort.abort();
      },
    };
  }
}

export const demoProviders = (stepMs?: number): AgentProvider[] => [new DemoProvider('claude-code', stepMs), new DemoProvider('codex', stepMs)];
