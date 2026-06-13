import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useStats } from '../hooks/useStats'

// AWS EC2 on-demand pricing, us-east-1, Linux (t3 family + EBS gp3, ~2025-2026)
const PRICE_VCPU_HR   = 0.0208  // t3 family: ~$0.0208/vCPU-hr
const PRICE_GBRAM_HR  = 0.0052  // t3 family: ~$0.0052/GB-hr
const PRICE_GBDISK_HR = 0.00011 // EBS gp3:   $0.08/GB-month ÷ 730

const CHART_PTS = [
  { t: '1h',  h: 1    },
  { t: '6h',  h: 6    },
  { t: '12h', h: 12   },
  { t: '1d',  h: 24   },
  { t: '3d',  h: 72   },
  { t: '7d',  h: 168  },
  { t: '14d', h: 336  },
  { t: '1mo', h: 730  },
  { t: '3mo', h: 2190 },
  { t: '6mo', h: 4380 },
  { t: '1y',  h: 8760 },
]

const GB = 1024 ** 3

export default function CostEstimator({ containers }) {
  const { data: stats } = useStats()
  const running = containers.filter(i => i.state === 'running')
  if (running.length === 0) return null

  // Use actual live usage from stats, not provisioned totals
  const totalCores  = stats?.total_cpus ?? 1
  const usedCpus    = stats?.cpu_percent != null ? (stats.cpu_percent / 100) * totalCores : 0
  const usedRamGb   = stats?.used_ram  != null ? stats.used_ram / GB : 0
  const usedDiskGb  = stats?.used_disk != null ? stats.used_disk / GB : 0

  const cpuCostHr  = usedCpus   * PRICE_VCPU_HR
  const ramCostHr  = usedRamGb  * PRICE_GBRAM_HR
  const diskCostHr = usedDiskGb * PRICE_GBDISK_HR
  const hourly = cpuCostHr + ramCostHr + diskCostHr

  const chartData = CHART_PTS.map(p => ({ t: p.t, cost: +(hourly * p.h).toFixed(4) }))

  const fmtY = v => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : v >= 1 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`

  const monthly = hourly * 730

  return (
    <div className="card dashboard-cost-card">
      {/* Header */}
      <div className="dashboard-cost-header">
        <div className="dashboard-cost-header-main">
          <p className="section-title">Cost Estimator</p>
          <a
            href="https://aws.amazon.com/ec2/pricing/on-demand/"
            target="_blank" rel="noreferrer"
            className="dashboard-cost-link"
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)' }}
          >
            EC2 prices ↗
          </a>
        </div>
        <div className="dashboard-cost-summary">
          <p className="mono dashboard-cost-monthly">
            ${monthly.toFixed(2)}
          </p>
          <p className="dashboard-cost-monthly-meta">/month est.</p>
        </div>
      </div>

      {/* Breakdown legend */}
      <div className="dashboard-cost-breakdown">
        {[
          { label: `${usedCpus.toFixed(1)} vCPU`,      cost: cpuCostHr,  color: '#6fa8ff' },
          { label: `${usedRamGb.toFixed(1)} GB RAM`,   cost: ramCostHr,  color: '#ff7bdc' },
          { label: `${usedDiskGb.toFixed(1)} GB Disk`, cost: diskCostHr, color: '#8ec5ff' },
        ].map(({ label, cost, color }) => (
          <div key={label} className="dashboard-cost-breakdown-item">
            <div className="dashboard-cost-breakdown-dot" style={{ background: color }} />
            <span className="mono dashboard-cost-breakdown-label">{label}</span>
            <span className="mono dashboard-cost-breakdown-price">${(cost * 730).toFixed(2)}/mo</span>
          </div>
        ))}
      </div>

      {/* Cost over time chart */}
      <p className="section-label" style={{ marginBottom: 10 }}>Cumulative cost over time</p>
      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#6fa8ff" stopOpacity={0.18} />
              <stop offset="95%" stopColor="#ff7bdc" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="t"
            tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
            axisLine={false} tickLine={false}
          />
          <YAxis
            tickFormatter={fmtY}
            tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
            axisLine={false} tickLine={false} width={52}
          />
          <Tooltip
            contentStyle={{ background: 'var(--card-2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11, fontFamily: 'IBM Plex Mono', color: 'var(--text-primary)' }}
            itemStyle={{ color: '#6fa8ff' }}
            formatter={v => [`$${Number(v).toFixed(2)}`, 'cumulative']}
            labelStyle={{ color: 'var(--text-secondary)', marginBottom: 2 }}
            cursor={{ stroke: 'var(--border-hover)', strokeWidth: 1 }}
          />
          <Area
            type="monotone" dataKey="cost"
            stroke="#6fa8ff" strokeWidth={1.5}
            fill="url(#costGrad)" dot={false} activeDot={{ r: 3, fill: '#ff7bdc', strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
