import type { ExecutionMode } from '@codeo/domain';
import { Select } from '@codeo/ui-desktop';
import { useT } from '../lib/i18n';

const EXECUTION_MODES: ExecutionMode[] = ['manual', 'auto', 'full'];

export function ExecutionModeSelect({ value, onChange, ...rest }: { value: ExecutionMode; onChange: (v: ExecutionMode) => void; id?: string; 'aria-label'?: string; disabled?: boolean }) {
  const t = useT();
  return (
    <Select {...rest} value={value} onChange={(e) => onChange(e.target.value as ExecutionMode)}>
      {EXECUTION_MODES.map((m) => (
        <option key={m} value={m}>
          {t(`executionMode.${m}`)}
        </option>
      ))}
    </Select>
  );
}
