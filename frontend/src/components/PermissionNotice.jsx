import { ShieldAlert } from 'lucide-react'

export default function PermissionNotice({
  title = 'Action Not Permitted',
  description = 'Your current role does not allow this action.',
}) {
  return (
    <div
      style={{
        marginTop: 8,
        border: '1px solid var(--border)',
        borderRadius: 14,
        background: 'var(--card-1)',
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        maxWidth: 760,
      }}
    >
      <ShieldAlert size={17} style={{ color: 'var(--stopped)', flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
      <div style={{ display: 'grid', gap: 4 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</p>
        <p className="mono" style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
          {description}
        </p>
      </div>
    </div>
  )
}
