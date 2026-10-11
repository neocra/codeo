import { describe, expect, it } from 'vitest';
import { translateThreadEvent } from '../src/translate';

describe('translateThreadEvent', () => {
  it('maps thread lifecycle and command items', () => {
    const t0 = Date.now();
    expect(translateThreadEvent({ type: 'thread.started', thread_id: 'th1' }, t0)[0]).toMatchObject({ type: 'session_started', providerSessionId: 'th1' });
    const started = translateThreadEvent({ type: 'item.started', item: { id: 'c1', type: 'command_execution', command: 'ls', aggregated_output: '', status: 'in_progress' } }, t0);
    expect(started[0]).toMatchObject({ type: 'tool_call_started', tool: 'Bash', input: { command: 'ls' } });
    const done = translateThreadEvent({ type: 'item.completed', item: { id: 'c1', type: 'command_execution', command: 'ls', aggregated_output: 'a\nb', status: 'completed', exit_code: 0 } }, t0);
    expect(done[0]).toMatchObject({ type: 'tool_call_completed', output: 'a\nb', isError: false });
    expect(translateThreadEvent({ type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } }, t0)[0]).toMatchObject({ type: 'turn_completed', ok: true });
  });
});
