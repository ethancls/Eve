/**
 * Shared skeleton components.
 *
 * SkeletonTable  — full table shell matching any page's column layout
 * SkeletonCards  — responsive card grid
 *
 * cols (for SkeletonTable): array of { w, h?, pill?, hw? }
 *   w    — cell body skeleton width (px)
 *   h    — cell body skeleton height (default 12)
 *   pill — if true, borderRadius: 100 (badge shape)
 *   hw   — header skeleton width override (default: w * 0.65)
 */

const SHELL_STYLE = {
  background: 'var(--card-1)',
  borderRadius: 'var(--r-card)',
  border: '1px solid var(--border)',
  overflow: 'visible',
}

export function SkeletonTable({ cols, rows = 5, hasCheckbox = false, minWidth = 700 }) {
  return (
    <div className="instances-table-shell" style={SHELL_STYLE}>
      <div className="instances-table-scroll no-scrollbar" style={{ overflowX: 'auto', overflowY: 'visible' }}>
        <table style={{ width: '100%', minWidth, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {hasCheckbox && (
                <th style={{ padding: '12px 10px 12px 14px', width: 40 }}>
                  <div className="skeleton" style={{ width: 18, height: 18, borderRadius: 5 }} />
                </th>
              )}
              {cols.map((col, colIdx) => (
                <th key={`h-${col.w}-${colIdx}`} style={{ padding: '12px 18px' }}>
                  <div className="skeleton" style={{ height: 9, width: col.hw ?? Math.round(col.w * 0.65), borderRadius: 4 }} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, n) => `r${n}`).map((rowKey, rowIdx) => (
              <tr key={rowKey} style={{ borderBottom: rowIdx < rows - 1 ? '1px solid var(--border)' : 'none' }}>
                {hasCheckbox && (
                  <td style={{ padding: '14px 10px 14px 14px' }}>
                    <div className="skeleton" style={{ width: 18, height: 18, borderRadius: 5 }} />
                  </td>
                )}
                {cols.map((col, colIdx) => (
                  <td key={`c-${col.w}-${colIdx}`} style={{ padding: '14px 18px' }}>
                    <div
                      className="skeleton"
                      style={{
                        height: col.h ?? 12,
                        width: col.w,
                        borderRadius: col.pill ? 100 : 5,
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function SkeletonCards({ count = 6, minCardWidth = 280 }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(auto-fill, minmax(min(${minCardWidth}px, 100%), 1fr))`,
      gap: 12,
    }}>
      {Array.from({ length: count }, (_, n) => `card-${n}`).map((cardKey, cardIdx) => (
        <div key={cardKey} className="card" style={{ padding: 16 }}>
          {/* Header: name + badge */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div className="skeleton" style={{ width: 100 + (cardIdx % 3) * 16, height: 13, borderRadius: 5 }} />
            <div className="skeleton" style={{ width: 48, height: 20, borderRadius: 100 }} />
          </div>
          {/* 2-col stat cells */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            {[0, 1].map((j) => (
              <div key={j} style={{ background: 'var(--card-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 10px' }}>
                <div className="skeleton" style={{ width: 38, height: 8, borderRadius: 3, marginBottom: 7 }} />
                <div className="skeleton" style={{ width: 56 + j * 12, height: 11, borderRadius: 4 }} />
              </div>
            ))}
          </div>
          {/* Footer line */}
          <div className="skeleton" style={{ width: `${55 + (cardIdx % 4) * 8}%`, height: 10, borderRadius: 4 }} />
        </div>
      ))}
    </div>
  )
}
