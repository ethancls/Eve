import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check, Search, X } from 'lucide-react'

const EMPTY_STYLE = {}

export default function CustomSelect({
  value,
  onChange,
  options,
  id,
  disabled = false,
  placeholder = 'Select…',
  searchable = false,
  dropUp = false,
  dropdownWidth = 'trigger',
  controlHeight = null,
  menuMaxHeight = 240,
  style = EMPTY_STYLE,
  multi = false,
  fontFamily = 'var(--font-mono)',
  fontSize = 13,
  optionFontSize = 13,
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef(null)
  const searchRef = useRef(null)
  const normalizedOptions = Array.isArray(options) ? options : []
  const selected = normalizedOptions.find(o => o.value === value)
  const multiValues = multi ? (Array.isArray(value) ? value : []) : []
  const isSelected = (v) => multi ? multiValues.includes(v) : value === v

  // Determine if any option has a tag — to reserve tag column consistently
  const hasTags = normalizedOptions.some(o => o.tag)
  const hasIcons = normalizedOptions.some(o => o.icon)

  useEffect(() => {
    const fn = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])

  useEffect(() => {
    if (!open) return
    const fn = (e) => { if (e.key === 'Escape') { setOpen(false); setQuery('') } }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [open])

  useEffect(() => {
    if (open && searchable) {
      setTimeout(() => searchRef.current?.focus(), 30)
    }
  }, [open, searchable])

  useEffect(() => {
    if (disabled && open) {
      const id = setTimeout(() => {
        setOpen(false)
        setQuery('')
      }, 0)
      return () => clearTimeout(id)
    }
  }, [disabled, open])

  const filtered = query.trim()
    ? normalizedOptions.filter((o) => {
        const text = [
          o.label,
          o.description,
          o.group,
          typeof o.value === 'string' ? o.value : '',
        ].filter(Boolean).join(' ').toLowerCase()
        return text.includes(query.toLowerCase())
      })
    : normalizedOptions

  function handleOpen() {
    if (disabled) return
    setOpen(o => !o)
    setQuery('')
  }

  function handleSelect(val) {
    if (disabled) return
    if (multi) {
      const next = multiValues.includes(val)
        ? multiValues.filter(v => v !== val)
        : [...multiValues, val]
      onChange(next)
      return
    }
    onChange(val)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', ...style }}>
      {/* Trigger */}
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={handleOpen}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--card-2)',
          border: '1px solid',
          borderColor: open ? 'var(--focus-ring)' : 'var(--border)',
          borderRadius: 'var(--r-sm)',
          ...(!multi && controlHeight
            ? { height: controlHeight, padding: '0 12px' }
            : { padding: multi ? '7px 12px' : '9px 12px' }),
          color: (multi ? multiValues.length > 0 : !!selected) ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontFamily, fontSize, lineHeight: 1.15,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.55 : 1,
          textAlign: 'left',
          transition: 'border-color 0.15s, background 0.15s',
        }}
        onMouseEnter={e => { if (!open && !disabled) { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.background = 'var(--card-3)' } }}
        onMouseLeave={e => { if (!open) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--card-2)' } }}
      >
        {multi ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, flex: 1, minHeight: 22 }}>
            {multiValues.length === 0 ? (
              <span style={{ color: 'var(--text-secondary)', lineHeight: '22px', whiteSpace: 'nowrap' }}>{placeholder}</span>
            ) : multiValues.map(v => {
              const opt = normalizedOptions.find(o => o.value === v)
              return (
                <span key={v} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontSize: 11, fontWeight: 600,
                  background: 'var(--accent-dim)', color: 'var(--accent)',
                  border: '1px solid var(--accent-border)', borderRadius: 6, padding: '2px 7px',
                }}>
                  {opt?.label ?? v}
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); onChange(multiValues.filter(x => x !== v)) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'inherit', lineHeight: 1 }}
                  >
                    <X size={9} />
                  </button>
                </span>
              )
            })}
          </div>
        ) : (
          <span style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            {hasIcons && (
              <span style={{
                width: 14, height: 14,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, color: selected ? 'currentColor' : 'var(--text-secondary)',
              }}>
                {selected?.icon || null}
              </span>
            )}
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.15 }}>
              {selected?.label ?? placeholder}
            </span>
          </span>
        )}
        {!multi && selected?.tag && (
          <span style={{
            fontSize: 10,
            background: selected.tagBg || 'var(--accent-dim)',
            color: selected.tagColor || 'var(--accent)',
            border: `1px solid ${selected.tagBorderColor || 'var(--accent-border)'}`,
            borderRadius: 5, padding: '2px 6px',
            fontFamily: 'Syne', fontWeight: 700, flexShrink: 0,
          }}>{selected.tag}</span>
        )}
        <ChevronDown
          size={12}
          style={{
            color: 'var(--text-secondary)', flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s',
          }}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="custom-select-dropdown" style={{
          position: 'absolute',
          ...(dropUp
            ? { bottom: 'calc(100% + 4px)' }
            : { top: 'calc(100% + 4px)' }),
          left: 0,
          ...(dropdownWidth === 'content'
            ? { minWidth: '100%', width: 'max-content', maxWidth: 'min(90vw, 640px)' }
            : { right: 0 }),
          zIndex: 400,
          background: 'var(--card-3)', border: '1px solid var(--border)',
          borderRadius: 12, boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
        }}>
          {/* Search input */}
          {searchable && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 12px', borderBottom: '1px solid var(--border)',
              background: 'var(--card-2)',
            }}>
              <Search size={12} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
              <input
                ref={searchRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search…"
                style={{
                  flex: 1, background: 'none', border: 'none', outline: 'none',
                  color: 'var(--text-primary)', fontFamily, fontSize: optionFontSize,
                }}
              />
            </div>
          )}

          {/* Options */}
          <div style={{ maxHeight: menuMaxHeight, overflowY: 'auto' }}>
            {filtered.length === 0 && (
              <p style={{ padding: '12px', fontSize: optionFontSize, color: 'var(--text-secondary)', fontFamily, margin: 0 }}>
                No results
              </p>
            )}
            {filtered.map((opt, idx) => (
              <div key={`${opt.group || 'default'}:${opt.value}`}>
                {opt.group && (idx === 0 || filtered[idx - 1]?.group !== opt.group) && (
                  <p style={{
                    margin: 0,
                    padding: '8px 12px 6px',
                    fontSize: 10.5,
                    color: 'var(--text-secondary)',
                    borderBottom: '1px solid var(--border)',
                    background: 'var(--card-2)',
                    fontFamily,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}>
                    {opt.group}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => handleSelect(opt.value)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `${hasIcons ? '16px ' : ''}minmax(0, 1fr)${hasTags ? ' 52px' : ''} 16px`,
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    background: 'none',
                    border: 'none',
                    borderBottom: idx < filtered.length - 1 ? '1px solid var(--border)' : 'none',
                    padding: opt.description ? '10px 12px' : '9px 12px',
                    cursor: 'pointer',
                    color: isSelected(opt.value) ? 'var(--accent)' : 'var(--text-primary)',
                    fontFamily,
                    fontSize: optionFontSize,
                    lineHeight: 1,
                    transition: 'background 0.1s',
                    textAlign: 'left',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  {hasIcons && (
                    <span style={{
                      width: 16,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: isSelected(opt.value) ? 'var(--accent)' : 'var(--text-secondary)',
                    }}>
                      {opt.icon || null}
                    </span>
                  )}
                  <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.15 }}>
                      {opt.label}
                    </span>
                    {opt.description && (
                      <span style={{
                        fontSize: 10.5,
                        color: 'var(--text-secondary)',
                        lineHeight: 1.25,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }}>
                        {opt.description}
                      </span>
                    )}
                  </span>

                  {hasTags && (
                    <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      {opt.tag && (
                        <span style={{
                          fontSize: 10,
                          background: opt.tagBg || 'var(--accent-dim)',
                          color: opt.tagColor || 'var(--accent)',
                          border: `1px solid ${opt.tagBorderColor || 'var(--accent-border)'}`,
                          borderRadius: 5, padding: '2px 6px',
                          fontFamily: 'Syne', fontWeight: 700, whiteSpace: 'nowrap',
                        }}>{opt.tag}</span>
                      )}
                    </span>
                  )}

                  <span style={{ display: 'flex', justifyContent: 'center', width: 16 }}>
                    {isSelected(opt.value) && <Check size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                  </span>
                </button>
              </div>
            ))}
          </div>
          {multi && multiValues.length > 0 && (
            <div style={{
              padding: '7px 12px', borderTop: '1px solid var(--border)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              background: 'var(--card-2)',
            }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily }}>
                {multiValues.length} selected
              </span>
              <button
                type="button"
                onClick={() => { onChange([]); setOpen(false); setQuery('') }}
                style={{ fontSize: 11, fontFamily: 'Syne', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, transition: 'color 0.13s' }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--stopped)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
              >Clear all</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
