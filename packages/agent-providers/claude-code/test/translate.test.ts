import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { StreamTranslator } from '../src/translate';

const sid = 'ses-123';
describe('StreamTranslator', () => {
  it('maps init, deltas, final text, tool calls, results', () => {
    const t = new StreamTranslator();
    const init = t.translate({ type: 'system', subtype: 'init', session_id: sid, model: 'claude-x', uuid: 'u1' } as unknown as SDKMessage);
    expect(init[0]).toMatchObject({ type: 'session_started', providerSessionId: sid, model: 'claude-x' });

    const d1 = t.translate({ type: 'stream_event', session_id: sid, uuid: 'u2', parent_tool_use_id: null, event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } } as unknown as SDKMessage);
    expect(d1).toEqual([]);
    const d2 = t.translate({ type: 'stream_event', session_id: sid, uuid: 'u3', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Bon' } } } as unknown as SDKMessage);
    expect(d2[0]).toMatchObject({ type: 'text_delta', delta: 'Bon' });
    const blockId = (d2[0] as { blockId: string }).blockId;

    const full = t.translate({ type: 'assistant', session_id: sid, uuid: 'u4', parent_tool_use_id: null, message: { role: 'assistant', content: [{ type: 'text', text: 'Bonjour' }, { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } }] } } as unknown as SDKMessage);
    expect(full[0]).toMatchObject({ type: 'text_complete', blockId, text: 'Bonjour' });
    expect(full[1]).toMatchObject({ type: 'tool_call_started', toolUseId: 'tu1', tool: 'Bash' });

    const res = t.translate({ type: 'user', session_id: sid, parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'a.ts\nb.ts' }] } } as unknown as SDKMessage);
    expect(res[0]).toMatchObject({ type: 'tool_call_completed', toolUseId: 'tu1', output: 'a.ts\nb.ts', isError: false });

    const done = t.translate({ type: 'result', subtype: 'success', is_error: false, result: 'done', duration_ms: 10, total_cost_usd: 0.01, num_turns: 2, session_id: sid, uuid: 'u5' } as unknown as SDKMessage);
    expect(done[0]).toMatchObject({ type: 'turn_completed', ok: true, summary: 'done', turns: 2 });
  });
  it('ignores subagent messages', () => {
    const t = new StreamTranslator();
    const out = t.translate({ type: 'assistant', session_id: sid, uuid: 'u', parent_tool_use_id: 'parent', message: { content: [{ type: 'text', text: 'sub' }] } } as unknown as SDKMessage);
    expect(out).toEqual([]);
  });
});
