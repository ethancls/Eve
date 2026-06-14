import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, Download, Package, Trash2 } from 'lucide-react'
import { toast } from '../toast'
import { api } from '../api/client'
import ContainerDataTable from '../components/ContainerDataTable'
import CustomSelect from '../components/CustomSelect'
import ConfirmModal from '../components/ConfirmModal'
import ResourceActionButton from '../components/ResourceActionButton'
import ImageUpdateCell from '../components/ImageUpdateCell'
import { RegistryProviderIcon } from '../components/RegistryProviderIcon'
import { SkeletonTable } from '../components/Skeletons'
import TableToolbar from '../components/TableToolbar'
import { useColumnVisibility } from '../hooks/useColumnVisibility'

const EMPTY_IMAGES = []
const EMPTY_RESULTS = []

function imageName(item) {
  const full = item.name || '-'
  const name = imageRepository(full)
  const url = dockerHubURL(full)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Package size={18} color="var(--accent)" style={{ flexShrink: 0 }} />
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {name}
          <ArrowUpRight size={12} style={{ opacity: 0.5 }} />
        </a>
      ) : (
        <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{name}</span>
      )}
    </div>
  )
}

function imageRepository(image) {
  const withoutDigest = String(image || '').split('@')[0]
  const lastSlash = withoutDigest.lastIndexOf('/')
  const lastColon = withoutDigest.lastIndexOf(':')
  return lastColon > lastSlash ? withoutDigest.slice(0, lastColon) : withoutDigest
}

function dockerHubURL(image) {
  let repo = imageRepository(image)
  if (!repo || repo === '<none>') return null
  const firstSegment = repo.split('/')[0]
  const hasRegistry = firstSegment.includes('.') || firstSegment.includes(':') || firstSegment === 'localhost'
  if (hasRegistry) {
    if (firstSegment !== 'docker.io' && firstSegment !== 'index.docker.io') return null
    repo = repo.split('/').slice(1).join('/')
  }
  if (repo.startsWith('library/')) repo = repo.slice('library/'.length)
  const parts = repo.split('/').filter(Boolean)
  if (parts.length === 1) return `https://hub.docker.com/_/${parts[0]}`
  if (parts.length >= 2) return `https://hub.docker.com/r/${parts[0]}/${parts[1]}`
  return null
}

function imageTag(item) {
  if (item.tag) return item.tag
  const full = item.name || ''
  const parts = full.split(':')
  return parts.length > 1 ? parts.slice(1).join(':') : '-'
}

function imageSize(item) {
  return formatBytes(item.size)
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0
  if (!value) return '—'
  const gb = value / (1024 ** 3)
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  const mb = value / (1024 ** 2)
  if (mb >= 1) return `${mb.toFixed(0)} MB`
  return `${(value / 1024).toFixed(0)} KB`
}

function formatDate(value) {
  if (!value) return '-'
  const date = new Date(value * 1000)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function usageState(item) {
  return (item.containers || []).length > 0 ? 'used' : 'unused'
}

function normalizeProvider(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'ghcr' || raw === 'ghcr.io') return 'ghcr.io'
  return 'docker.io'
}

function UsageBadge({ value }) {
  const used = value === 'used'
  return (
    <span className="badge" style={{
      background: used ? 'var(--accent-dim)' : 'var(--card-2)',
      color: used ? 'var(--accent)' : 'var(--text-muted)',
      borderColor: used ? 'var(--accent-border)' : 'var(--border)',
      textTransform: 'uppercase',
    }}>
      {used ? 'Used' : 'Unused'}
    </span>
  )
}

export default function Images() {
  const qc = useQueryClient()
  const [query, setQuery] = useState('')
  const [usageFilter, setUsageFilter] = useState('all')
  const [provider, setProvider] = useState('docker.io')
  const [registryQuery, setRegistryQuery] = useState('')
  const [deleteImage, setDeleteImage] = useState(null)
  const defaultProviderInitialized = useRef(false)
  const providerTouched = useRef(false)

  const localImagesQuery = useQuery({
    queryKey: ['images-local'],
    queryFn: () => api.getLocalImages(),
    refetchInterval: 15000,
    retry: false,
  })

  const defaultProviderQuery = useQuery({
    queryKey: ['setting', 'registry.default_provider'],
    queryFn: () => api.getSetting('registry.default_provider'),
    staleTime: 60000,
    retry: false,
  })

  useEffect(() => {
    if (!defaultProviderQuery.isSuccess || defaultProviderInitialized.current || providerTouched.current) return
    defaultProviderInitialized.current = true
    const timer = setTimeout(() => {
      setProvider(normalizeProvider(defaultProviderQuery.data?.value))
    }, 0)
    return () => clearTimeout(timer)
  }, [defaultProviderQuery.data?.value, defaultProviderQuery.isSuccess])

  const registryQueryResult = useQuery({
    queryKey: ['registry-search', provider, registryQuery],
    queryFn: () => api.searchRegistry(provider, registryQuery),
    enabled: Boolean(registryQuery.trim()),
    staleTime: 60000,
    retry: false,
  })

  const localImages = localImagesQuery.data?.images || EMPTY_IMAGES
  const registryProviderOptions = useMemo(() => [
    { value: 'docker.io', label: 'Docker Hub', icon: <RegistryProviderIcon provider="docker.io" /> },
    { value: 'ghcr.io', label: 'GHCR', icon: <RegistryProviderIcon provider="ghcr.io" /> },
  ], [])
  const localColumns = useMemo(() => [
    { key: 'name', label: 'Image', accent: false, render: imageName },
    { key: 'usage', label: 'Usage', render: (item) => <UsageBadge value={usageState(item)} /> },
    { key: 'tag', label: 'Tag / Digest', render: imageTag },
    { key: 'update', label: 'Update', width: 72, textAlign: 'center', render: (item) => <ImageUpdateCell image={item.name} /> },
    { key: 'size', label: 'Size', render: imageSize },
    { key: 'created', label: 'Created', render: (item) => formatDate(item.created) },
  ], [])
  const registryColumns = useMemo(() => [
    { key: 'name', label: 'Name', accent: true, render: (item) => item.image || item.repo_name || item.name },
    { key: 'short_description', label: 'Description', render: (item) => item.short_description || item.description || '-' },
    { key: 'star_count', label: 'Stars' },
    { key: 'pull_count', label: 'Pulls' },
  ], [])
  const localColumnState = useColumnVisibility(localColumns, 'images_local_cols')
  const registryColumnState = useColumnVisibility(registryColumns, 'images_registry_cols')
  const filteredLocal = useMemo(() => {
    const q = query.trim().toLowerCase()
    return localImages.filter((item) => {
      const usage = usageState(item)
      if (usageFilter !== 'all' && usage !== usageFilter) return false
      if (!q) return true
      const n = (item.name || '').toLowerCase()
      const t = (item.tag || '').toLowerCase()
      return n.includes(q) || t.includes(q) || usage.includes(q)
    })
  }, [localImages, query, usageFilter])

  async function pull(image) {
    const promise = api.imageAction({ action: 'pull', image }).then(() => {
      qc.invalidateQueries({ queryKey: ['images-local'] })
      qc.invalidateQueries({ queryKey: ['activity'] })
    })
    toast.promise(promise, {
      loading: { title: `Pulling ${image}` },
      success: { title: `Pulled ${image}` },
      error: (e) => ({ title: e.message }),
    })
    await promise
  }

  async function removeImage(image) {
    const promise = api.imageAction({ action: 'delete', image }).then(() => {
      qc.invalidateQueries({ queryKey: ['images-local'] })
      qc.invalidateQueries({ queryKey: ['activity'] })
    })
    toast.promise(promise, {
      loading: { title: `Deleting ${image}` },
      success: { title: `Deleted ${image}` },
      error: (e) => ({ title: e.message }),
    })
    await promise
  }

  return (
    <div className="page">
      <div className="instances-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">Images</h1>
        </div>
      </div>

      <section style={{ marginBottom: 40 }}>
        <div className="instances-controls" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
          <div className="instances-state-filters" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: '1 1 280px' }}>
            <button className="filter-pill active" type="button">Local <span className="pill-count">{localImages.length}</span></button>
          </div>
          <TableToolbar
            query={query}
            onQueryChange={setQuery}
            placeholder="Search local images..."
            columnConfig={localColumnState.columnConfig}
            setColumnConfig={localColumnState.setColumnConfig}
            style={{ width: 'clamp(280px, 34vw, 460px)' }}
          >
            <CustomSelect
              value={usageFilter}
              onChange={setUsageFilter}
              options={[
                { value: 'all', label: 'All usage' },
                { value: 'used', label: 'Used' },
                { value: 'unused', label: 'Unused' },
              ]}
              controlHeight={30}
              style={{ width: 130 }}
            />
          </TableToolbar>
        </div>

        {localImagesQuery.isLoading ? (
          <SkeletonTable cols={[{ w: 180 }, { w: 120 }, { w: 80 }]} rows={3} />
        ) : (
          <ContainerDataTable
            items={filteredLocal}
            empty="No local images"
            columns={localColumnState.visibleColumns}
            renderActions={(item) => {
              const name = item.name && item.name !== '<none>' ? item.name : item.id
              if (usageState(item) === 'used') return null
              return (
                <div style={{ display: 'inline-flex', gap: 5 }}>
                  <ResourceActionButton icon={<Trash2 size={14} />} label="Delete image" color="var(--stopped)" onClick={() => setDeleteImage(name)} />
                </div>
              )
            }}
          />
        )}

      </section>

      <section>
        <div className="instances-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
          <p className="section-title" style={{ margin: 0 }}>Registry Search</p>
          <TableToolbar
            query={registryQuery}
            onQueryChange={setRegistryQuery}
            placeholder={provider === 'ghcr.io' ? 'owner/image' : 'Search images'}
            columnConfig={registryColumnState.columnConfig}
            setColumnConfig={registryColumnState.setColumnConfig}
            style={{ width: 'clamp(300px, 36vw, 520px)' }}
          >
            <CustomSelect
              value={provider}
              onChange={(next) => {
                providerTouched.current = true
                setProvider(next)
              }}
              options={registryProviderOptions}
              controlHeight={30}
              style={{ width: 150 }}
            />
          </TableToolbar>
        </div>
        {registryQueryResult.error && <p className="mono" style={{ color: 'var(--stopped)', marginBottom: 12 }}>{registryQueryResult.error.message}</p>}
        <ContainerDataTable
          items={registryQueryResult.data?.results || EMPTY_RESULTS}
          empty={registryQuery.trim() ? 'No registry images' : 'Search Docker Hub or GHCR'}
          columns={registryColumnState.visibleColumns}
          renderActions={(item) => {
            const ref = item.image || item.repo_name || item.name
            return <ResourceActionButton icon={<Download size={14} />} label="Pull image" color="var(--running)" onClick={() => pull(ref)} />
          }}
        />
      </section>

      {deleteImage && (
        <ConfirmModal
          title={`Delete Image`}
          description={`Are you sure you want to delete ${deleteImage}? This will permanently remove the local image.`}
          confirmLabel="Delete"
          variant="confirm"
          onClose={() => setDeleteImage(null)}
          onConfirm={() => removeImage(deleteImage).finally(() => setDeleteImage(null))}
        />
      )}
    </div>
  )
}
