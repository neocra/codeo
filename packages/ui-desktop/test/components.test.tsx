import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalCard, Button, StatusPill, Tabs, TaskRow } from '../src/index';

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
