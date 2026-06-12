'use client';

export function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
  isDisabled,
}: {
  options:     { label: string; value: T }[];
  value:       T;
  onChange:    (v: T) => void;
  isDisabled?: (v: T) => boolean;
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        backgroundColor: 'var(--color-border)',
        borderRadius: '8px',
        padding: '3px',
        gap: '2px',
      }}
    >
      {options.map((o) => {
        const disabled = isDisabled?.(o.value) ?? false;
        const active   = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => !disabled && onChange(o.value)}
            disabled={disabled}
            style={{
              padding: '5px 13px',
              fontSize: '12.5px',
              fontFamily: 'var(--font-body)',
              fontWeight: active ? 600 : 400,
              letterSpacing: '-0.01em',
              cursor: disabled ? 'not-allowed' : 'pointer',
              backgroundColor: active ? 'var(--color-surface)' : 'transparent',
              color: disabled
                ? 'var(--color-border-strong)'
                : active
                ? 'var(--color-primary)'
                : 'var(--color-text-muted)',
              border: 'none',
              borderRadius: '6px',
              outline: 'none',
              transition: 'background-color 0.12s ease, color 0.12s ease',
              boxShadow: active ? '0 1px 3px rgba(6,44,67,0.1)' : 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
