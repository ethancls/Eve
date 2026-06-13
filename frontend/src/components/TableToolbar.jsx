import { useState } from 'react'
import { Columns, Eye, EyeOff, Search, X } from 'lucide-react'
import Modal from './Modal'

function ColumnsModal({ config, setConfig, onClose }) {
  const [draggedId, setDraggedId] = useState(null)
  const visibleCount = config.filter((col) => col.visible).length

  function toggle(id) {
    setConfig((current) => current.map((col) => (
      col.id === id && (visibleCount > 1 || !col.visible) ? { ...col, visible: !col.visible } : col
    )))
  }

  function moveColumn(targetId) {
    if (!draggedId || draggedId === targetId) return
    setConfig((current) => {
      const next = [...current]
      const from = next.findIndex((col) => col.id === draggedId)
      const to = next.findIndex((col) => col.id === targetId)
      if (from < 0 || to < 0) return current
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  return (
    <Modal title="Manage Columns" onClose={onClose} size="sm">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {config.map((col) => (
          <div
            key={col.id}
            draggable
            onDragStart={() => setDraggedId(col.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => moveColumn(col.id)}
            onDragEnd={() => setDraggedId(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 12px',
              background: 'var(--card-2)',
              borderRadius: 8,
              border: '1px solid var(--border)',
              opacity: col.visible ? 1 : 0.55,
              cursor: 'grab',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span className="mono" style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1 }}>::</span>
              <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>
                {col.label}
              </span>
            </span>
            <button
              type="button"
              onClick={() => toggle(col.id)}
              disabled={col.visible && visibleCount <= 1}
              style={{
                background: 'none',
                border: 'none',
                cursor: col.visible && visibleCount <= 1 ? 'not-allowed' : 'pointer',
                color: col.visible ? 'var(--accent)' : 'var(--text-muted)',
                padding: 6,
                borderRadius: 4,
                opacity: col.visible && visibleCount <= 1 ? 0.5 : 1,
              }}
            >
              {col.visible ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
          </div>
        ))}
      </div>
    </Modal>
  )
}

export default function TableToolbar({
  query,
  onQueryChange,
  placeholder,
  columnConfig,
  setColumnConfig,
  children,
  style,
}) {
  const [columnsOpen, setColumnsOpen] = useState(false)
  return (
    <div
      className="instances-search-control"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-sm)',
        padding: '0 10px',
        height: 36,
        minWidth: 260,
        background: 'var(--card-1)',
        position: 'relative',
        marginLeft: 'auto',
        ...style,
      }}
    >
      {columnConfig && setColumnConfig && (
        <>
          <button
            type="button"
            onClick={() => setColumnsOpen(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: 4,
            }}
            title="Manage columns"
          >
            <Columns size={15} />
          </button>
          {columnsOpen && (
            <ColumnsModal
              config={columnConfig}
              setConfig={setColumnConfig}
              onClose={() => setColumnsOpen(false)}
            />
          )}
        </>
      )}
      {children}
      <div style={{ width: 1, height: 16, background: 'var(--border)' }} />
      <Search size={14} color="var(--text-muted)" />
      <input
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1,
          minWidth: 0,
          background: 'transparent',
          border: 0,
          outline: 0,
          color: 'var(--text-primary)',
          fontSize: 13,
        }}
      />
      {query && (
        <button
          type="button"
          onClick={() => onQueryChange('')}
          style={{ background: 'none', border: 0, color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 0 }}
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}
