import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ProviderEvent } from '@codeo/agent-provider-core';

export interface Translation {
  events: ProviderEvent[];
}

interface Block {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

function blockText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b: Block) => (typeof b === 'string' ? b : b?.type === 'text' ? (b.text ?? '') : ''))
      .join('');
  }
  return '';
}

/**
 * Translates SDK stream messages into provider events. Stateful only for the current
 * streaming text block so deltas and the final assistant block map to one entry.
 */
export class StreamTranslator {
  private streamingBlockId: string | null = null;
  private streamed = '';
  private counter = 0;
  private nextBlockId(): string {
    this.counter += 1;
    return `blk_${Date.now().toString(36)}_${this.counter}`;
  }

  translate(msg: SDKMessage): ProviderEvent[] {
    const out: ProviderEvent[] = [];
    switch (msg.type) {
      case 'system': {
        if (msg.subtype === 'init') {
          out.push({ type: 'session_started', providerSessionId: msg.session_id, model: msg.model ?? null });
        } else if (msg.subtype === 'session_state_changed') {
          out.push({ type: 'status', state: msg.state });
        }
        return out;
      }
      case 'stream_event': {
        const ev = msg.event as { type: string; index?: number; content_block?: Block; delta?: { type?: string; text?: string } };
        if (ev.type === 'content_block_start' && ev.content_block?.type === 'text') {
          this.streamingBlockId = this.nextBlockId();
          this.streamed = '';
        } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
          if (!this.streamingBlockId) {
            this.streamingBlockId = this.nextBlockId();
            this.streamed = '';
          }
          this.streamed += ev.delta.text;
          out.push({ type: 'text_delta', blockId: this.streamingBlockId, delta: ev.delta.text });
        }
        return out;
      }
      case 'assistant': {
        if (msg.parent_tool_use_id) return out; // subagent chatter stays out of the main transcript
        const blocks = (msg.message?.content ?? []) as Block[];
        for (const b of blocks) {
          if (b.type === 'text') {
            const text = b.text ?? '';
            const id = this.streamingBlockId ?? this.nextBlockId();
            out.push({ type: 'text_complete', blockId: id, text });
            this.streamingBlockId = null;
            this.streamed = '';
          } else if (b.type === 'thinking' && b.thinking) {
            out.push({ type: 'thinking', text: b.thinking });
          } else if (b.type === 'tool_use' && b.id && b.name) {
            out.push({
              type: 'tool_call_started',
              toolUseId: b.id,
              tool: b.name,
              input: (b.input && typeof b.input === 'object' ? (b.input as Record<string, unknown>) : {}),
            });
          }
        }
        if (msg.error) out.push({ type: 'error', message: String(msg.error), fatal: false });
        return out;
      }
      case 'user': {
        if (msg.parent_tool_use_id) return out;
        const content = msg.message?.content;
        if (Array.isArray(content)) {
          for (const b of content as Block[]) {
            if (b.type === 'tool_result' && b.tool_use_id) {
              out.push({
                type: 'tool_call_completed',
                toolUseId: b.tool_use_id,
                output: blockText(b.content).slice(0, 20_000) || null,
                isError: Boolean(b.is_error),
              });
            }
          }
        }
        return out;
      }
      case 'result': {
        if (msg.subtype === 'success') {
          out.push({
            type: 'turn_completed',
            ok: !msg.is_error,
            summary: msg.result,
            durationMs: msg.duration_ms,
            costUsd: msg.total_cost_usd,
            turns: msg.num_turns,
          });
        } else {
          out.push({
            type: 'turn_completed',
            ok: false,
            summary: msg.errors.join('\n') || msg.subtype,
            durationMs: msg.duration_ms,
            costUsd: msg.total_cost_usd,
            turns: msg.num_turns,
          });
        }
        this.streamingBlockId = null;
        return out;
      }
      case 'auth_status': {
        if (msg.error) out.push({ type: 'error', message: msg.error, fatal: false });
        return out;
      }
      default:
        return out;
    }
  }
}

export function translateMessage(msg: SDKMessage): Translation {
  return { events: new StreamTranslator().translate(msg) };
}
