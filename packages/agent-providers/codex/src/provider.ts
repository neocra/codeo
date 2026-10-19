import { Codex, type Thread, type ThreadOptions } from '@openai/codex-sdk';
import { codexSandboxMode, ProviderUnavailableError, type AgentProvider, type ProviderSessionHandle, type StartSessionOptions } from '@codeo/agent-provider-core';
import type { ProviderStatus } from '@codeo/domain';
import { detectCodex, resolveCodexExecutable } from './detect';
import { translateThreadEvent } from './translate';

export interface CodexProviderOptions {
  executablePath?: string;
  sandboxMode?: ThreadOptions['sandboxMode'];
}

/**
 * Codex adapter over the official `@openai/codex-sdk`. Turns are sequential per thread:
 * `send()` queues a prompt and runs it after the current turn finishes.
 */
export class CodexProvider implements AgentProvider {
  readonly id = 'codex' as const;
  readonly displayName = 'Codex';
  private status: ProviderStatus | null = null;

  constructor(private readonly opts: CodexProviderOptions = {}) {}

  async detect(): Promise<ProviderStatus> {
    this.status = await detectCodex(this.opts.executablePath);
    return this.status;
  }

  async startSession(opts: StartSessionOptions): Promise<ProviderSessionHandle> {
    const status = this.status ?? (await this.detect());
    if (!status.installed) throw new ProviderUnavailableError('codex', status.error ?? 'Codex non installé');
    const exe = resolveCodexExecutable(this.opts.executablePath);
    const codex = new Codex(exe ? { codexPathOverride: exe } : {});
    const threadOptions: ThreadOptions = {
      workingDirectory: opts.cwd,
      sandboxMode: this.opts.sandboxMode ?? codexSandboxMode(opts.executionMode),
      skipGitRepoCheck: true,
      ...(opts.model && opts.model !== 'default' ? { model: opts.model } : {}),
    };
    const thread: Thread = opts.resumeProviderSessionId
      ? codex.resumeThread(opts.resumeProviderSessionId, threadOptions)
      : codex.startThread(threadOptions);
    const log = opts.logger.child('codex');
    let providerSessionId: string | null = opts.resumeProviderSessionId;
    let current: AbortController | null = null;
    let closed = false;
    let chain: Promise<void> = Promise.resolve();
    let preambleSent = Boolean(opts.resumeProviderSessionId);

    const runTurn = async (text: string) => {
      if (closed) return;
      const ac = new AbortController();
      current = ac;
      const startedAt = Date.now();
      const prompt = preambleSent ? text : `${opts.roleInstructions}\n\n${text}`;
      preambleSent = true;
      try {
        const { events } = await thread.runStreamed(prompt, { signal: ac.signal });
        for await (const ev of events) {
          for (const out of translateThreadEvent(ev, startedAt)) {
            if (out.type === 'session_started') providerSessionId = out.providerSessionId;
            opts.onEvent(out);
          }
        }
        if (!providerSessionId && thread.id) providerSessionId = thread.id;
      } catch (err) {
        if (ac.signal.aborted) {
          opts.onEvent({ type: 'turn_completed', ok: false, summary: 'Interrompu', durationMs: Date.now() - startedAt, costUsd: null, turns: 1 });
        } else {
          log.error('turn failed', { err: String(err) });
          opts.onEvent({ type: 'error', message: err instanceof Error ? err.message : String(err), fatal: false });
        }
      } finally {
        current = null;
      }
    };

    return {
      get providerSessionId() {
        return providerSessionId;
      },
      async send(text) {
        chain = chain.then(() => runTurn(text));
      },
      async interrupt() {
        current?.abort();
      },
      async close() {
        closed = true;
        current?.abort();
        await chain.catch(() => undefined);
      },
    };
  }
}
