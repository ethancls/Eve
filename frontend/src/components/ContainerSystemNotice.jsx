import { useQuery, useQueryClient } from '@tanstack/react-query'
import { TriangleAlert, RefreshCw } from 'lucide-react'
import { api } from '../api/client'
import Modal from './Modal'

export default function ContainerSystemNotice() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['container-system'],
    queryFn: () => api.getContainerSystem(),
    staleTime: 10000,
    refetchInterval: 15000,
    retry: false,
  })

  if (isLoading) return null
  const system = data?.system
  if (!system || system.running) return null

  async function retry() {
    qc.invalidateQueries({ queryKey: ['container-system'] })
    qc.invalidateQueries({ queryKey: ['containers'] })
  }

  return (
    <Modal
      title="Docker daemon not running"
      size="sm"
      onClose={() => {}}
      closeOnEsc={false}
      closeOnOverlay={false}
      showClose={false}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, paddingTop: 4 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          background: 'rgba(239,68,68,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <TriangleAlert size={22} style={{ color: 'var(--stopped)' }} />
        </div>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.55 }}>
          {system.error || 'Cannot connect to the Docker daemon. Is it running?'}
        </p>
        <button className="btn-accent" type="button" onClick={retry} style={{ marginTop: 4 }}>
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    </Modal>
  )
}
