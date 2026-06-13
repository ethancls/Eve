import { useMemo, useState } from 'react'
import { useQuery, useQueries } from '@tanstack/react-query'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { api } from '../api/client'
import CustomSelect from './CustomSelect'

const METRICS = [
  { key: 'cpu', label: 'CPU', unit: '%', transform: v => Number(v || 0).toFixed(2) },
  { key: 'ram_used', label: 'RAM Used', unit: 'MB', transform: v => v ? Number((v / (1024 ** 2)).toFixed(1)) : 0 },
  { key: 'disk_used', label: 'Disk Used', unit: 'GB', transform: v => v ? Number((v / (1024 ** 3)).toFixed(2)) : 0 },
]

const ALL_VALUE = '__all__'
const EMPTY_INSTANCES = []
const SERIES_COLORS = ['#6fa8ff','#ff7bdc','#a78bfa','#f472b6','#818cf8','#ec4899','#4f7cff','#e11d48','#8ec5ff','#f8719e','#6366f1','#fb7185']

function SingleTooltip({ active, payload, label, unit }) {
  if (!active || !payload?.length) return null
  const val = payload[0]?.value
  const prev = payload[0]?.payload?.prev
  const delta = prev != null ? (val - prev).toFixed(2) : null
  return (
    <div style={{
      background: 'var(--card-3)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '10px 14px', fontSize: 12, fontFamily: 'IBM Plex Mono',
    }}>
      <p style={{ margin: 0, color: 'var(--text-secondary)', marginBottom: 4 }}>{label}</p>
      <p style={{ margin: 0, color: 'var(--accent)', fontWeight: 600 }}>{val} {unit}</p>
      {delta != null && (
        <p style={{ margin: 0, color: delta > 0 ? 'var(--stopped)' : 'var(--running)', marginTop: 2 }}>
          {delta > 0 ? '+' : ''}{delta} {unit}
        </p>
      )}
    </div>
  )
}

function MultiTooltip({ active, payload, label, unit }) {
  if (!active || !payload?.length) return null
  const rows = payload
    .filter(p => p.value != null)
    .sort((a, b) => Number(b.value) - Number(a.value))

  return (
    <div style={{
      background: 'var(--card-3)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '10px 14px', fontSize: 12, fontFamily: 'IBM Plex Mono', minWidth: 170,
    }}>
      <p style={{ margin: 0, color: 'var(--text-secondary)', marginBottom: 8 }}>{label}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((row) => (
          <div key={row.name} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ width: 8, height: 8, borderRadius: 3, background: row.color, flexShrink: 0 }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
              {Number(row.value).toFixed(unit === 'MB' ? 1 : unit === '%' ? 1 : 2)} {unit}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ResourceChart({ instances = EMPTY_INSTANCES }) {
  const [selectedVm, setSelectedVm] = useState(ALL_VALUE)
  const [metricKey, setMetricKey] = useState(METRICS[0].key)
  const metric = METRICS.find(m => m.key === metricKey) ?? METRICS[0]
  const isAll = selectedVm === ALL_VALUE

  const { data: singleData } = useQuery({
    queryKey: ['history', selectedVm],
    queryFn: () => api.getHistory(selectedVm),
    enabled: !isAll && !!selectedVm,
    refetchInterval: 6000,
  })
  const multiQueries = useQueries({
    queries: instances.map(inst => ({
      queryKey: ['history', inst.name],
      queryFn: () => api.getHistory(inst.name),
      enabled: isAll,
      refetchInterval: 6000,
      staleTime: 4000,
    })),
  })

  const raw = singleData?.history ?? []
  const chartData = raw.map((p, i) => ({
    ts: new Date(p.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
    value: metric.transform(p[metric.key]),
    prev: i > 0 ? metric.transform(raw[i - 1][metric.key]) : null,
  }))

  const allChartData = useMemo(() => {
    if (!isAll || instances.length === 0) return []
    const byTs = new Map()

    instances.forEach((inst, idx) => {
      const history = multiQueries[idx]?.data?.history ?? []
      history.forEach((point) => {
        const rawTs = point.ts
        if (!byTs.has(rawTs)) {
          byTs.set(rawTs, {
            tsRaw: rawTs,
            ts: new Date(rawTs).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
          })
        }
        byTs.get(rawTs)[inst.name] = metric.transform(point[metric.key])
      })
    })

    return Array.from(byTs.values()).sort((a, b) => new Date(a.tsRaw).getTime() - new Date(b.tsRaw).getTime())
  }, [instances, isAll, metric, multiQueries])

  const singleTickInterval = Math.max(0, Math.ceil(chartData.length / 6) - 1)
  const allTickInterval = Math.max(0, Math.ceil(allChartData.length / 6) - 1)

  const vmOptions = [{ value: ALL_VALUE, label: 'All containers' }, ...instances.map(i => ({ value: i.name, label: i.name }))]
  const metricOptions = METRICS.map(m => ({ value: m.key, label: m.label }))

  return (
    <div className="card">
      <div className="resource-chart-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 10, flexWrap: 'wrap' }}>
        <p className="section-title">Resource History</p>
        <div className="resource-chart-controls" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', width: 'min(100%, 420px)' }}>
          <CustomSelect
            value={selectedVm}
            onChange={setSelectedVm}
            options={vmOptions}
            placeholder="Select VM…"
            searchable
            dropdownWidth="content"
            style={{ minWidth: 140, flex: '1 1 180px' }}
          />
          <CustomSelect
            value={metricKey}
            onChange={setMetricKey}
            options={metricOptions}
            style={{ minWidth: 120, flex: '1 1 140px' }}
          />
        </div>
      </div>

      {(!isAll && chartData.length === 0) || (isAll && allChartData.length === 0) ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--text-secondary)', fontSize: 12, fontFamily: 'IBM Plex Mono' }}>
          No data yet — waiting for first poll
        </div>
      ) : isAll ? (
        <>
          <ResponsiveContainer width="100%" height={230}>
            <AreaChart data={allChartData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
              <defs>
                {instances.map((inst, i) => (
                  <linearGradient key={`grad-${inst.name}`} id={`all-grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={SERIES_COLORS[i % SERIES_COLORS.length]} stopOpacity={0.18} />
                    <stop offset="95%" stopColor={SERIES_COLORS[i % SERIES_COLORS.length]} stopOpacity={0.01} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis
                dataKey="ts"
                tick={{ fontSize: 10, fontFamily: 'IBM Plex Mono', fill: '#888' }}
                tickLine={false}
                axisLine={false}
                interval={allTickInterval}
                minTickGap={24}
              />
              <YAxis
                tick={{ fill: 'var(--text-secondary)', fontSize: 10, fontFamily: 'IBM Plex Mono' }}
                tickLine={false}
                axisLine={false}
                width={50}
                tickMargin={8}
              />
              <Tooltip content={<MultiTooltip unit={metric.unit} />} />
              {instances.map((inst, i) => (
                <Area
                  key={inst.name}
                  type="monotone"
                  dataKey={inst.name}
                  stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                  strokeWidth={2}
                  fill={`url(#all-grad-${i})`}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', gap: 18, marginTop: 10, flexWrap: 'wrap' }}>
            {instances.map((inst, i) => {
              const idx = instances.findIndex(x => x.name === inst.name)
              const query = multiQueries[idx]
              const history = query?.data?.history || []
              const last = history[history.length - 1]
              const lastVal = last ? metric.transform(last[metric.key]) : null
              return (
                <div key={inst.name} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 3, background: SERIES_COLORS[i % SERIES_COLORS.length], flexShrink: 0 }} />
                  <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{inst.name}</span>
                  {lastVal != null && <span className="mono" style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 600 }}>{lastVal} {metric.unit}</span>}
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6fa8ff" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#ff7bdc" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
            <XAxis
              dataKey="ts"
              tick={{ fontSize: 10, fontFamily: 'IBM Plex Mono', fill: '#888' }}
              tickLine={false}
              axisLine={false}
              interval={singleTickInterval}
              minTickGap={24}
            />
            <YAxis
              tick={{ fill: 'var(--text-secondary)', fontSize: 10, fontFamily: 'IBM Plex Mono' }}
              tickLine={false}
              axisLine={false}
              width={50}
              tickMargin={8}
            />
            <Tooltip content={<SingleTooltip unit={metric.unit} />} />
            <Area type="monotone" dataKey="value" stroke="#6fa8ff" strokeWidth={2} fill="url(#grad)" dot={false} activeDot={{ r: 4, fill: '#ff7bdc' }} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
