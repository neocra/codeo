import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  htmlFor?: string | undefined;
}
export function Field({ label, hint, error, children, htmlFor }: FieldProps) {
  return (
    <div className="cd-field">
      <label className="cd-field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <span className="cd-field__error">{error}</span> : hint ? <span className="cd-field__hint">{hint}</span> : null}
    </div>
  );
}

export function Input({ className, mono, ...rest }: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean | undefined }) {
  return <input {...rest} className={['cd-input', mono && 'cd-input--mono', className].filter(Boolean).join(' ')} />;
}
export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={['cd-textarea', className].filter(Boolean).join(' ')} />;
}
export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className={['cd-select', className].filter(Boolean).join(' ')} />;
}

export interface ChoiceProps {
  checked: boolean;
  onChange: () => void;
  label: ReactNode;
  sub?: ReactNode;
  type?: 'radio' | 'checkbox' | undefined;
  name?: string | undefined;
  disabled?: boolean | undefined;
}
export function Choice({ checked, onChange, label, sub, type = 'radio', name, disabled }: ChoiceProps) {
  return (
    <label className={['cd-choice', checked && 'is-on', disabled && 'is-disabled'].filter(Boolean).join(' ')} aria-disabled={disabled || undefined}>
      <input type={type} checked={checked} onChange={onChange} name={name} disabled={disabled} />
      <span>
        {label}
        {sub ? <span className="cd-choice__sub">{sub}</span> : null}
      </span>
    </label>
  );
}
