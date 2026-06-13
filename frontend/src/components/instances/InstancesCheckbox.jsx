export default function InstancesCheckbox({ checked, onChange }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onChange() }}
      style={{
        width: 22,
        height: 22,
        borderRadius: 6,
        border: `1px solid ${checked ? 'var(--accent-fill)' : 'var(--border-hover)'}`,
        background: checked ? 'var(--accent-dim)' : 'var(--card-2)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
      }}
      aria-pressed={checked}
      aria-label={checked ? 'Unselect instance' : 'Select instance'}
    >
      <span style={{
        width: 10,
        height: 10,
        borderRadius: 3,
        background: checked ? 'var(--accent-fill)' : 'transparent',
      }} />
    </button>
  )
}
