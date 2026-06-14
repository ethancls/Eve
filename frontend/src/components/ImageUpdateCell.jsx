import { useQuery } from '@tanstack/react-query'
import { HelpCircle } from 'lucide-react'
import { api } from '../api/client'

export default function ImageUpdateCell({ image }) {
  const img = image || '-'
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['image-update', img],
    queryFn: () => api.checkImageUpdate(img),
    enabled: Boolean(img) && img !== '<none>' && img !== '-',
    staleTime: 0,
    retry: 1,
  })

  if (!img || img === '<none>' || img === '-') return <span style={{ color: 'var(--text-muted)' }}>—</span>

  if (isLoading) {
    return <div style={{ width: 16, height: 16, borderRadius: 4, background: 'var(--card-2)', animation: 'skeleton-shimmer 2s ease-in-out infinite' }} />
  }

  const hasUpdate = data?.update_available === true
  const cantCompare = !data?.local_digest || !data?.remote_digest
  const hasError = data?.error && !data?.remote_digest

  const title = hasError ? `Registry error: ${data.error}. Click to retry.`
    : hasUpdate ? 'Update available! Click to re-check.'
    : cantCompare ? 'Unable to compare. Click to re-check.'
    : 'Up to date. Click to re-check.'

  return (
    <button
      onClick={() => refetch()}
      title={title}
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }}
    >
      {isFetching ? (
        <div style={{ width: 14, height: 14, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
      ) : hasError ? (
        <HelpCircle size={15} color="var(--text-muted)" />
      ) : hasUpdate ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#f59e0b" strokeWidth="2" /><path d="M12 8v5M12 16h.01" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" /></svg>
      ) : cantCompare ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#888" strokeWidth="2" /><path d="M8 12h8M12 8v8" stroke="#888" strokeWidth="2" strokeLinecap="round" /></svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#22c55e" strokeWidth="2" /><path d="M8 12l3 3 5-5" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      )}
    </button>
  )
}
