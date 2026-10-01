import type { ReactNode } from 'react';

interface Props {
  label: ReactNode;
  required?: boolean;
  help?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Field({ label, required, help, className, children }: Props) {
  return (
    <label className={`block ${className ?? ''}`}>
      <span className="field-label">
        {label}
        {required && (
          <span className="required-star" aria-label="required">
            *
          </span>
        )}
      </span>
      {children}
      {help && <div className="help-text">{help}</div>}
    </label>
  );
}
