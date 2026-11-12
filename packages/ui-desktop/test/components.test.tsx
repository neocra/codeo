import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalCard, Button, DiffView, StatusPill, Tabs, TaskRow, highlight } from '../src/index';

describe('design components', () => {
  it('Button renders variants and loading state', () => {
    const { rerender } = render(<Button variant="primary">Créer une tâche</Button>);
    expect(screen.getByRole('button')).toHaveClass('cd-btn--primary');
    rerender(<Button loading>Créer</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
  });
  it('StatusPill carries its tone and word', () => {
    render(<StatusPill tone="live">Session active</StatusPill>);
    expect(screen.getByRole('status')).toHaveClass('cd-pill--live');
    expect(screen.getByRole('status')).toHaveTextContent('Session active');
  });
  it('Tabs calls onChange', () => {
    const onChange = vi.fn();
    render(<Tabs items={[{ id: 'a', label: 'Tous', count: 3 }, { id: 'b', label: 'Backlog' }]} value="a" onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: /Backlog/ }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
  it('TaskRow is keyboard activatable', () => {
    const onClick = vi.fn();
    render(<TaskRow ticket="PROJ-123" title="Sync" statusLabel="En cours" tone="live" onClick={onClick} />);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    expect(onClick).toHaveBeenCalled();
  });
  it('ApprovalCard approves through the callback and morphs', async () => {
    const onApprove = vi.fn(async () => undefined);
    render(<ApprovalCard ticket="PROJ-123" kind="Modifications de code" title="PR #428" approveLabel="Approuver" approvedLabel="Approuvé" onApprove={onApprove} />);
    fireEvent.click(screen.getByRole('button', { name: /Approuver/ }));
    expect(onApprove).toHaveBeenCalled();
    expect(await screen.findByText('Approuvé', { selector: '.cd-done span' })).toBeInTheDocument();
  });
});

describe('diff highlighting', () => {
  const classes = (src: string) => {
    const { container } = render(<div>{highlight(src)}</div>);
    return { text: container.textContent, spans: [...container.querySelectorAll('span')].map((s) => [s.className, s.textContent]) };
  };

  it('colours keywords, functions, types, strings, numbers and comments, keeping the text intact', () => {
    const src = "const total = sum(o, 'a\\'b', 12.5) + Order.x2 // fin";
    const { text, spans } = classes(src);
    expect(text).toBe(src);
    expect(spans).toEqual([
      ['syn-k', 'const'],
      ['syn-f', 'sum'],
      ['syn-s', "'a\\'b'"],
      ['syn-n', '12.5'],
      ['syn-t', 'Order'],
      ['syn-c', '// fin'],
    ]);
  });

  it('stays linear on inputs that made the old regex backtrack', () => {
    for (const src of ['"' + '\\"'.repeat(50_000), "'" + "\\'".repeat(50_000), '//'.repeat(50_000), 'x'.repeat(100_000)]) {
      const started = performance.now();
      const { text } = classes(src);
      expect(text).toBe(src);
      expect(performance.now() - started).toBeLessThan(2000);
    }
  });

  it('lets a numbered diff line be selected with the keyboard, but not a hunk header', () => {
    const onLineSelect = vi.fn();
    render(<DiffView file="a.ts" lines={[{ type: 'ctx', text: '@@ -1 +1 @@' }, { type: 'add', new: 1, text: 'x' }]} onLineSelect={onLineSelect} lineSelectLabel="Commenter" />);
    const lines = screen.getAllByRole('button', { name: 'Commenter' });
    expect(lines).toHaveLength(1);
    fireEvent.keyDown(lines[0]!, { key: 'Enter' });
    expect(onLineSelect).toHaveBeenCalledWith({ type: 'add', new: 1, text: 'x' }, 1);
  });
});
