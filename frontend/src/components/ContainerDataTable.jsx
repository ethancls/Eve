import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'

function valueAt(item, key) {
  if (!key) return ''
  const raw = item?.[key]
  if (raw == null) return ''
  if (typeof raw === 'object') return JSON.stringify(raw)
  return String(raw)
}

function fallbackColumns(items) {
  const seen = new Set()
  for (const item of items.slice(0, 5)) {
    Object.keys(item || {}).forEach((key) => {
      if (key !== 'raw') seen.add(key)
    })
  }
  return [...seen].slice(0, 5).map((key) => ({ key, label: key }))
}

function SortTh({ col, sort, onSort }) {
  const active = sort.key === col.key
  const Icon = active ? (sort.dir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown
  return (
    <th
      onClick={() => col.key && onSort(col.key)}
      style={{
        padding: '10px 12px',
        textAlign: 'left',
        fontSize: 10.5,
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        cursor: col.key ? 'pointer' : 'default',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {col.label}
        {col.key && <Icon size={11} style={{ opacity: active ? 1 : 0.45 }} />}
      </span>
    </th>
  )
}

function SelectionRadio({ checked, onChange, label }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={checked}
      onClick={(e) => {
        e.stopPropagation()
        onChange()
      }}
      style={{
        width: 22,
        height: 22,
        borderRadius: 999,
        border: `1px solid ${checked ? 'var(--accent-fill)' : 'var(--border-hover)'}`,
        background: checked ? 'var(--accent-dim)' : 'var(--card-2)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        transition: 'background 0.12s, border-color 0.12s',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          background: checked ? 'var(--accent-fill)' : 'transparent',
        }}
      />
    </button>
  )
}

export default function ContainerDataTable({
  items = [],
  columns,
  empty = 'No resources',
  renderActions,
  tableMinWidth = 760,
  tableLayout = 'auto',
  selectionWidth = 42,
  actionsWidth,
  selectedKeys = null,
  getItemKey = (item) => item.id || item.name || item.image,
  onToggleSelect,
  onToggleSelectAll,
}) {
  const resolvedColumns = useMemo(() => columns?.length ? columns : fallbackColumns(items), [columns, items])
  const [sort, setSort] = useState({ key: resolvedColumns[0]?.key || '', dir: 'asc' })
  const selectable = selectedKeys instanceof Set && typeof onToggleSelect === 'function'

  function toggleSort(key) {
    setSort((current) => current.key === key
      ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' })
  }

  const sorted = useMemo(() => [...items].sort((a, b) => {
    const cmp = valueAt(a, sort.key).localeCompare(valueAt(b, sort.key))
    return sort.dir === 'asc' ? cmp : -cmp
  }), [items, sort])
  const allSelected = selectable && sorted.length > 0 && sorted.every((item) => selectedKeys.has(getItemKey(item)))

  return (
    <div className="instances-table-shell" style={{ background: 'var(--card-1)', borderRadius: 'var(--r-card)', border: '1px solid var(--border)', overflow: 'visible' }}>
      <div className="instances-table-scroll no-scrollbar" style={{ overflowX: 'auto', overflowY: 'visible' }}>
        <table style={{ width: '100%', minWidth: tableMinWidth, tableLayout, borderCollapse: 'collapse' }}>
          <colgroup>
            {selectable && <col style={{ width: selectionWidth }} />}
            {resolvedColumns.map((col) => (
              <col key={col.key || col.label} style={col.width ? { width: col.width } : undefined} />
            ))}
            {renderActions && <col style={actionsWidth ? { width: actionsWidth } : undefined} />}
          </colgroup>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {selectable && (
                <th style={{ padding: '10px 8px 10px 12px', width: selectionWidth }}>
                  <SelectionRadio
                    checked={allSelected}
                    label={allSelected ? 'Unselect visible containers' : 'Select visible containers'}
                    onChange={() => onToggleSelectAll?.(sorted.map(getItemKey), allSelected)}
                  />
                </th>
              )}
              {resolvedColumns.map((col) => <SortTh key={col.key || col.label} col={col} sort={sort} onSort={toggleSort} />)}
              {renderActions && <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 10.5, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em', width: actionsWidth }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={resolvedColumns.length + (renderActions ? 1 : 0) + (selectable ? 1 : 0)} style={{ padding: 34, textAlign: 'center' }}>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{empty}</span>
                </td>
              </tr>
            )}
            {sorted.map((item, idx) => {
              const key = getItemKey(item) || idx
              const selected = selectable && selectedKeys.has(key)
              return (
                <tr
                  key={key}
                  style={{
                    borderBottom: idx < sorted.length - 1 ? '1px solid var(--border)' : 'none',
                    background: selected ? 'rgba(111,168,255,0.08)' : 'transparent',
                  }}
                >
                  {selectable && (
                    <td style={{ padding: '10px 8px 10px 12px' }}>
                      <SelectionRadio
                        checked={selected}
                        label={selected ? 'Unselect container' : 'Select container'}
                        onChange={() => onToggleSelect(key)}
                      />
                    </td>
                  )}
                  {resolvedColumns.map((col) => (
                    <td key={col.key || col.label} style={{ padding: '10px 12px', maxWidth: col.maxWidth || 300, textAlign: col.textAlign || 'left' }}>
                      <span className="mono" style={{ fontSize: 12, color: col.accent ? 'var(--accent)' : 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                        {col.render ? col.render(item) : (valueAt(item, col.key) || '-')}
                      </span>
                    </td>
                  ))}
                  {renderActions && (
                    <td style={{ padding: '10px 12px', textAlign: 'right', width: actionsWidth, maxWidth: actionsWidth }}>
                      {renderActions(item)}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
