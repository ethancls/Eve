import ResourceUsage from '../instances/ResourceUsage'

function Stat({ label, value, accent = false, children = null }) {
  return (
    <div style={{
      background: 'transparent',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '8px 10px',
      minWidth: 0,
      height: 62,
      display: 'flex',
      flexDirection: 'column',
      gap: 5,
    }}>
      <p className="section-label" style={{ margin: 0, lineHeight: 1, flexShrink: 0 }}>{label}</p>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', minWidth: 0, overflow: 'hidden' }}>
        {children ?? (
          <span
            className="mono"
            style={{
              fontSize: 13,
              lineHeight: 1,
              color: accent ? 'var(--accent)' : 'var(--text-primary)',
              fontWeight: 700,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {value}
          </span>
        )}
      </div>
    </div>
  )
}

export default function OverviewPanel({ instance }) {
  const ips = Array.isArray(instance?.ipv4) ? instance.ipv4.filter(Boolean) : []
  const networkValue = ips.length ? ips.join(', ') : 'No IPv4'
  const imageValue = instance?.image || '—'

  return (
    <div className="instance-details-stats" style={{ marginBottom: 14 }}>
      <Stat label="vCPUs" value={instance?.cpus ?? '—'} accent />
      <Stat label="RAM">
        <ResourceUsage used={instance?.memory?.used} total={instance?.memory?.total} donutSize={22} donutStroke={3} />
      </Stat>
      <Stat label="Disk">
        <ResourceUsage used={instance?.disk?.used} total={instance?.disk?.total} donutSize={22} donutStroke={3} />
      </Stat>
      <Stat label="Network" value={networkValue} />
      <Stat label="Image" value={imageValue} />
    </div>
  )
}
