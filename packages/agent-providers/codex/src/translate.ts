import type { ThreadEvent, ThreadItem } from '@openai/codex-sdk';
import type { ProviderEvent } from '@codeo/agent-provider-core';

function itemEvents(item: ThreadItem, phase: 'started' | 'updated' | 'completed'): ProviderEvent[] {
  switch (item.type) {
    case 'agent_message':
      return phase === 'completed' ? [{ type: 'text_complete', blockId: item.id, text: item.text }] : [{ type: 'text_delta', blockId: item.id, delta: item.text }];
    case 'reasoning':
      return phase === 'completed' ? [{ type: 'thinking', text: item.text }] : [];
    case 'command_execution':
      if (phase === 'started') return [{ type: 'tool_call_started', toolUseId: item.id, tool: 'Bash', input: { command: item.command } }];
      if (phase === 'completed')
        return [{ type: 'tool_call_completed', toolUseId: item.id, output: item.aggregated_output.slice(0, 20_000) || null, isError: item.status === 'failed' }];
      return [];
    case 'file_change':
      return phase === 'completed'
        ? [
            { type: 'tool_call_started', toolUseId: item.id, tool: 'Edit', input: { files: item.changes.map((c) => `${c.kind} ${c.path}`) } },
            { type: 'tool_call_completed', toolUseId: item.id, output: item.changes.map((c) => `${c.kind} ${c.path}`).join('\n'), isError: item.status === 'failed' },
          ]
        : [];
    case 'mcp_tool_call':
      if (phase === 'started') return [{ type: 'tool_call_started', toolUseId: item.id, tool: `mcp__${item.server}__${item.tool}`, input: { arguments: item.arguments } }];
      if (phase === 'completed') return [{ type: 'tool_call_completed', toolUseId: item.id, output: item.error?.message ?? JSON.stringify(item.result?.structured_content ?? null), isError: item.status === 'failed' }];
      return [];
    case 'web_search':
      return phase === 'started' ? [{ type: 'tool_call_started', toolUseId: item.id, tool: 'WebSearch', input: { query: item.query } }] : phase === 'completed' ? [{ type: 'tool_call_completed', toolUseId: item.id, output: null, isError: false }] : [];
    case 'todo_list':
      return phase === 'completed' ? [{ type: 'system', level: 'info', text: item.items.map((t) => `${t.completed ? '✓' : '○'} ${t.text}`).join('\n') }] : [];
    case 'error':
      return [{ type: 'error', message: item.message, fatal: false }];
    default:
      return [];
  }
}

export function translateThreadEvent(ev: ThreadEvent, startedAt: number): ProviderEvent[] {
  switch (ev.type) {
    case 'thread.started':
      return [{ type: 'session_started', providerSessionId: ev.thread_id, model: null }];
    case 'turn.started':
      return [{ type: 'status', state: 'running' }];
    case 'item.started':
      return itemEvents(ev.item, 'started');
    case 'item.updated':
      return itemEvents(ev.item, 'updated');
    case 'item.completed':
      return itemEvents(ev.item, 'completed');
    case 'turn.completed':
      return [{ type: 'turn_completed', ok: true, summary: '', durationMs: Date.now() - startedAt, costUsd: null, turns: 1 }];
    case 'turn.failed':
      return [{ type: 'turn_completed', ok: false, summary: ev.error.message, durationMs: Date.now() - startedAt, costUsd: null, turns: 1 }];
    case 'error':
      return [{ type: 'error', message: ev.message, fatal: true }];
    default:
      return [];
  }
}
