import { useStats } from '../hooks/useStats'

function fmt(bytes) {
  if (!bytes) return '0'
  const gb = bytes / (1024 ** 3)
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  const mb = bytes / (1024 ** 2)
  if (mb >= 1) return `${mb.toFixed(2)} MB`
  return `${(bytes / 1024).toFixed(2)} KB`
}

export default function OverviewCard() {
  const { data: stats, isLoading } = useStats()

  const items = [
    { label: 'Containers', value: stats?.total      ?? '—' },
    { label: 'Running',    value: stats?.running     ?? '—' },
    { label: 'Stopped',    value: stats?.stopped     ?? '—' },
    { label: 'CPU used',   value: stats?.cpu_percent != null ? `${stats.cpu_percent.toFixed(1)}%` : '—' },
    { label: 'RAM used',   value: stats ? fmt(stats.used_ram)  : '—' },
    { label: 'Disk used',  value: stats ? fmt(stats.used_disk) : '—' },
  ]

  return (
    <div className="dashboard-overview-card">
      {/* Decorative blobs */}
      <div className="dashboard-overview-blob dashboard-overview-blob--top" />
      <div className="dashboard-overview-blob dashboard-overview-blob--bottom" />

      <div className="dashboard-overview-content">
        <p className="dashboard-overview-eyebrow">Overview</p>
        <h2 className="dashboard-overview-title">
          Infrastructure
        </h2>

        <div className="overview-stats-grid dashboard-overview-stats">
          {items.map(({ label, value }) => (
            <div key={label} className="dashboard-overview-stat">
              <p className="dashboard-overview-stat-label">{label}</p>
              {isLoading ? (
                <div style={{ width: '60%', height: 18, borderRadius: 4, background: 'rgba(111,168,255,0.15)', animation: 'skeleton-shimmer 2s ease-in-out infinite', backgroundSize: '200% auto', backgroundImage: 'linear-gradient(90deg, rgba(111,168,255,0.10) 25%, rgba(255,123,220,0.20) 50%, rgba(111,168,255,0.10) 75%)' }} />
              ) : (
                <p className="mono dashboard-overview-stat-value">{value}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
