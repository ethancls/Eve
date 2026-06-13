import { useEffect, useMemo, useState } from 'react'

function mergeColumnConfig(columns, saved) {
  const defaults = columns.map((col) => ({
    id: col.key || col.label,
    label: col.label,
    visible: col.visible !== false,
  }))
  if (!Array.isArray(saved)) return defaults

  const byId = new Map(defaults.map((col) => [col.id, col]))
  const merged = []
  const seen = new Set()
  for (const item of saved) {
    if (!byId.has(item.id)) continue
    const base = byId.get(item.id)
    merged.push({ ...base, visible: item.visible !== false })
    seen.add(item.id)
  }
  for (const item of defaults) {
    if (!seen.has(item.id)) merged.push(item)
  }
  return merged
}

export function useColumnVisibility(columns, storageKey) {
  const [config, setConfig] = useState(() => {
    if (!storageKey) return mergeColumnConfig(columns)
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null')
      return mergeColumnConfig(columns, saved)
    } catch {
      return mergeColumnConfig(columns)
    }
  })

  useEffect(() => {
    if (!storageKey) return
    localStorage.setItem(storageKey, JSON.stringify(config))
  }, [config, storageKey])

  const visibleColumns = useMemo(() => {
    const byId = new Map(columns.map((col) => [col.key || col.label, col]))
    return config
      .filter((col) => col.visible)
      .map((col) => byId.get(col.id))
      .filter(Boolean)
  }, [columns, config])

  return { columnConfig: config, setColumnConfig: setConfig, visibleColumns }
}
