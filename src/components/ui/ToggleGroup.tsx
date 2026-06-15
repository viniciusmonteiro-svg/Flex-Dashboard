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
        backgroundColor: '#D6E6F0',
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
              backgroundColor: active ? 'var(--color-accent)' : 'transparent',
              color: disabled
                ? '#9BB5C5'
                : active
                ? '#FFFFFF'
                : 'var(--color-primary)',
              border: 'none',
              borderRadius: '6px',
              outline: 'none',
              transition: 'background-color 0.12s ease, color 0.12s ease',
              boxShadow: active ? '0 1px 4px rgba(0,180,216,0.3)' : 'none',
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
