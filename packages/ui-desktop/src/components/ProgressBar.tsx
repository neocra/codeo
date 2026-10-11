export interface ProgressBarProps {
  value: number;
  running?: boolean | undefined;
  tone?: 'mint' | 'amber' | 'sky' | undefined;
  showValue?: boolean | undefined;
  label?: string | undefined;
  className?: string | undefined;
}

export function ProgressBar({ value, running, tone, showValue = true, label = 'Progression', className }: ProgressBarProps) {
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <div className={['cd-progress', running && 'is-running', tone && `cd-progress--${tone}`, className].filter(Boolean).join(' ')}>
      <div className="cd-progress__track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} aria-label={label}>
        <div className="cd-progress__fill" style={{ width: `${v}%` }} />
      </div>
      {showValue ? <span className="cd-progress__value">{Math.round(v)}%</span> : null}
    </div>
  );
}
