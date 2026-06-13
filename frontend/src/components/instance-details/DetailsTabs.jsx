const EMPTY_TABS = []

export default function DetailsTabs({ tabs = EMPTY_TABS, value, onChange }) {
  return (
    <div style={{
      display: 'flex',
      borderBottom: '1px solid var(--border)',
      marginBottom: 16,
      gap: 0,
    }}>
      {tabs.map((tab) => {
        const isActive = value === tab.value
        const Icon = tab.icon
        return (
          <button
            key={tab.value}
            onClick={() => onChange(tab.value)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1,
              padding: '8px 16px',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: isActive ? 700 : 500,
              color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
              lineHeight: 1,
              transition: 'color 0.13s, border-color 0.13s',
              whiteSpace: 'nowrap',
              display: 'inline-flex',
              alignItems: 'center',
              gap: Icon ? 6 : 0,
            }}
            onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = 'var(--text-secondary)' }}
          >
            {Icon && <Icon size={13} style={{ flexShrink: 0 }} />}
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
