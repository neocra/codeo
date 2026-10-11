import { query, type Options, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  classifyToolUse,
  ProviderUnavailableError,
  type AgentProvider,
  type ProviderSessionHandle,
  type StartSessionOptions,
} from '@codeo/agent-provider-core';
import type { ProviderStatus } from '@codeo/domain';
import { Deferred } from '@codeo/shared-utils';
import { detectClaudeCode, resolveClaudeExecutable } from './detect';
import { StreamTranslator } from './translate';

/** Push-based async iterable feeding the SDK's streaming-input mode. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiters: Deferred<void>[] = [];
  private closed = false;

  push(text: string): void {
    if (this.closed) throw new Error('session input closed');
    this.items.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      origin: { kind: 'human' },
      timestamp: new Date().toISOString(),
    });
    this.waiters.shift()?.resolve();
  }
  close(): void {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w.resolve();
  }
  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (true) {
      const next = this.items.shift();
      if (next) {
        yield next;
        continue;
      }
      if (this.closed) return;
      const d = new Deferred<void>();
      this.waiters.push(d);
      await d.promise;
    }
  }
}

export interface ClaudeCodeProviderOptions {
  executablePath?: string;
  /** Default permission mode; 'default' routes sensitive tools to Codeo approvals. */
  permissionMode?: Options['permissionMode'];
}

export class ClaudeCodeProvider implements AgentProvider {
  readonly id = 'claude-code' as const;
  readonly displayName = 'Claude Code';
  private status: ProviderStatus | null = null;

  constructor(private readonly opts: ClaudeCodeProviderOptions = {}) {}

  async detect(): Promise<ProviderStatus> {
    this.status = await detectClaudeCode(this.opts.executablePath);
    return this.status;
  }

  async startSession(opts: StartSessionOptions): Promise<ProviderSessionHandle> {
    const status = this.status ?? (await this.detect());
    if (!status.installed) throw new ProviderUnavailableError('claude-code', status.error ?? 'Claude Code non installé');
    const exe = resolveClaudeExecutable(this.opts.executablePath);
    const input = new InputQueue();
    const translator = new StreamTranslator();
    const abort = new AbortController();
    const log = opts.logger.child('claude-code');
    let providerSessionId: string | null = opts.resumeProviderSessionId;
    let closed = false;

    const options: Options = {
      cwd: opts.cwd,
      abortController: abort,
      includePartialMessages: true,
      permissionMode: this.opts.permissionMode ?? 'default',
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code', append: opts.roleInstructions },
      env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'codeo/0.1.0' },
      stderr: (data) => log.debug('stderr', { data: data.slice(0, 500) }),
      canUseTool: async (toolName, toolInput, ctx) => {
        const cls = classifyToolUse(toolName, toolInput);
        const decision = await opts.onPermissionRequest({
          providerRequestId: ctx.toolUseID,
          tool: toolName,
          input: toolInput,
          summary: cls.summary,
          affected: cls.affected,
          risk: cls.risk,
          reason: ctx.decisionReason ?? null,
          signal: ctx.signal,
        });
        if (decision.behavior === 'allow') return { behavior: 'allow', updatedInput: toolInput, toolUseID: ctx.toolUseID };
        opts.onEvent({ type: 'tool_call_denied', toolUseId: ctx.toolUseID, reason: decision.message });
        return { behavior: 'deny', message: decision.message, toolUseID: ctx.toolUseID };
      },
      ...(exe ? { pathToClaudeCodeExecutable: exe } : {}),
      ...(opts.model && opts.model !== 'default' ? { model: opts.model } : {}),
      ...(providerSessionId ? { resume: providerSessionId } : {}),
    };

    const q: Query = query({ prompt: input, options });

    const pump = (async () => {
      try {
        for await (const msg of q) {
          if ('session_id' in msg && msg.session_id && !providerSessionId) providerSessionId = msg.session_id;
          for (const ev of translator.translate(msg)) {
            if (ev.type === 'session_started') providerSessionId = ev.providerSessionId;
            opts.onEvent(ev);
          }
        }
      } catch (err) {
        if (!closed && !abort.signal.aborted) {
          opts.onEvent({ type: 'error', message: err instanceof Error ? err.message : String(err), fatal: true });
        }
      } finally {
        input.close();
      }
    })();

    return {
      get providerSessionId() {
        return providerSessionId;
      },
      async send(text) {
        input.push(text);
      },
      async interrupt() {
        try {
          await q.interrupt();
        } catch (err) {
          log.warn('interrupt failed', { err: String(err) });
        }
      },
      async close() {
        closed = true;
        input.close();
        abort.abort();
        q.close();
        await pump.catch(() => undefined);
      },
    };
  }
}
