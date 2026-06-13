import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Play, Square, Trash2 } from 'lucide-react'
import { toast } from '../toast'
import { api } from '../api/client'

export default function Builder() {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['builder'],
    queryFn: () => api.getBuilder(),
    refetchInterval: 15000,
    retry: false,
  })

  async function action(name) {
    const promise = api.builderAction(name).then(() => qc.invalidateQueries({ queryKey: ['builder'] }))
    toast.promise(promise, {
      loading: { title: `Builder ${name}...` },
      success: { title: `Builder ${name} complete` },
      error: (e) => ({ title: e.message }),
    })
    await promise
  }

  return (
    <div className="page">
      <div className="instances-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <h1 className="page-title">Builder</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-accent" onClick={() => action('start')}><Play size={14} /> Start</button>
          <button className="btn-secondary" onClick={() => action('stop')}><Square size={14} /> Stop</button>
          <button className="btn-secondary danger" onClick={() => action('delete')}><Trash2 size={14} /> Delete</button>
        </div>
      </div>
      {error && <p className="mono" style={{ color: 'var(--stopped)', marginBottom: 12 }}>{error.message}</p>}
      <div className="card" style={{ padding: 16 }}>
        <pre className="mono" style={{ minHeight: 260, overflow: 'auto', margin: 0, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
          {isLoading ? 'Loading builder status...' : JSON.stringify(data?.builder || data?.text || data || {}, null, 2)}
        </pre>
      </div>
    </div>
  )
}
