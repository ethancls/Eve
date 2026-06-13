import Tooltip from '../Tooltip'

function clampPct(used, total) {
  if (!total) return null
  const pct = (used / total) * 100
  return Math.max(0, Math.min(100, pct))
}

function fmtPct(pct) {
  if (pct == null) return '—'
  const clamped = Math.max(0, Math.min(100, pct))
  return `${clamped.toFixed(1)}%`
}

function usageColor(pct) {
  if (pct == null) return 'var(--text-secondary)'
  if (pct >= 90) return 'var(--stopped)'
  if (pct >= 75) return 'var(--suspended)'
  return 'var(--accent)'
}

function usageTone(pct, isZeroUsage) {
  if (isZeroUsage || pct == null) return 'muted'
  if (pct >= 90) return 'danger'
  if (pct >= 75) return 'warn'
  return 'accent'
}

function formatBytes(bytes, { compact = false, zeroAsDash = false } = {}) {
  if (bytes == null || Number.isNaN(Number(bytes))) return '—'
  const n = Number(bytes)
  if (n <= 0) return zeroAsDash ? '—' : (compact ? '0M' : '0 MB')
  const gb = n / (1024 ** 3)
  if (gb >= 1) return compact ? `${gb.toFixed(1)}G` : `${gb.toFixed(1)} GB`
  const mb = n / (1024 ** 2)
  return compact ? `${mb.toFixed(0)}M` : `${mb.toFixed(0)} MB`
}

function UsageDonut({ pct, color, compact, sizeOverride = null, strokeOverride = null }) {
  const size = sizeOverride ?? (compact ? 20 : 20)
  const stroke = strokeOverride ?? (compact ? 2.8 : 2.8)
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const progress = ((pct ?? 0) / 100) * circumference

  return (
    <svg
      className="usage-donut"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--card-3)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${progress} ${circumference - progress}`}
      />
    </svg>
  )
}

export default function ResourceUsage({
  used = 0,
  total = 0,
  compact = false,
  mode = 'detail',
  label = '',
  showTooltip = false,
  showPercent = false,
  donutSize = null,
  donutStroke = null,
}) {
  const safeUsed = Number(used) || 0
  const safeTotal = Number(total) || 0
  const pct = clampPct(safeUsed, safeTotal)
  const pctLabel = fmtPct(pct)
  const isZeroUsage = safeUsed <= 0
  const color = isZeroUsage ? 'var(--text-muted)' : usageColor(pct)
  const tone = usageTone(pct, isZeroUsage)
  const usedLabel = formatBytes(safeUsed, { compact })
  const totalLabel = formatBytes(safeTotal, { compact, zeroAsDash: true })
  const hasData = safeUsed > 0 || safeTotal > 0
  const tooltipLabel = `${label ? `${label}: ` : ''}${formatBytes(safeUsed, { compact: true })} / ${formatBytes(safeTotal, { compact: true, zeroAsDash: true })}${pct != null ? ` (${pctLabel})` : ''}`

  if (!hasData) {
    return <span className={`mono usage-empty ${compact ? 'compact' : 'full'}`}>—</span>
  }

  if (mode === 'percent') {
    const content = (
      <div className={`usage-percent ${compact ? 'compact' : 'full'}`}>
        {label && (
          <span className="mono usage-percent-label">
            {label}
          </span>
        )}
        <span className={`usage-tone-${tone}`}>
          <UsageDonut
            pct={pct}
            color={color}
            compact={compact}
            sizeOverride={donutSize}
            strokeOverride={donutStroke}
          />
        </span>
        <span className={`mono usage-percent-value usage-tone-${tone}`}>
          {pctLabel}
        </span>
      </div>
    )
    return showTooltip ? <Tooltip label={tooltipLabel}>{content}</Tooltip> : content
  }

  return (
    <div className={`usage-detail ${compact ? 'compact' : 'full'}`}>
      <span className={`usage-tone-${tone}`}>
        <UsageDonut
          pct={pct}
          color={color}
          compact={compact}
          sizeOverride={donutSize}
          strokeOverride={donutStroke}
        />
      </span>

      <div className={`usage-detail-text ${showPercent ? 'with-percent' : ''}`}>
        {compact ? (
          <div className="mono usage-detail-compact-values">
            <span className="usage-tone-accent usage-detail-used">{usedLabel}</span>
            <span className="usage-detail-separator">/</span>
            <span className="usage-detail-total">{totalLabel}</span>
          </div>
        ) : (
          <div className="mono usage-detail-grid-values">
            <span className="usage-tone-accent usage-detail-used">{usedLabel}</span>
            <span className="usage-detail-separator">/</span>
            <span className="usage-detail-total">{totalLabel}</span>
          </div>
        )}
        {showPercent && (
          <span className={`mono usage-detail-percent usage-tone-${tone}`}>
            {pctLabel}
          </span>
        )}
      </div>
    </div>
  )
}
