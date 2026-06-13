export default function IOSToggle({ checked, disabled = false, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width: 46,
        height: 26,
        borderRadius: 999,
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: checked ? 'var(--accent)' : 'var(--card-3)',
        opacity: disabled ? 0.55 : 1,
        position: 'relative',
        transition: 'background 0.18s ease',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: checked ? 23 : 3,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: checked ? '#0a0a0a' : '#fff',
          transition: 'left 0.18s ease, background 0.18s ease',
          boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
        }}
      />
    </button>
  )
}
