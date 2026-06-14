import { useMemo, useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Play, Square, RefreshCw, FileText, Boxes } from 'lucide-react'
import { toast } from '../toast'
import { api } from '../api/client'
import ContainerDataTable from '../components/ContainerDataTable'
import Modal from '../components/Modal'
import ResourceActionButton from '../components/ResourceActionButton'
import YamlEditor from '../components/YamlEditor'
import TableToolbar from '../components/TableToolbar'
import { useColumnVisibility } from '../hooks/useColumnVisibility'

export default function Projects() {
  const qc = useQueryClient()
  const [selectedProject, setSelectedProject] = useState(null)
  const [query, setQuery] = useState('')
  
  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const res = await api.getProjects()
      return res.projects || []
    },
    refetchInterval: 10000,
  })

  async function runAction(name, action) {
    const promise = api.projectAction(name, action).then((res) => {
      qc.invalidateQueries({ queryKey: ['containers'] })
      if (res.error) throw new Error(res.error)
    })
    toast.promise(promise, {
      loading: { title: `Running ${action} on ${name}...` },
      success: { title: `Project ${name} ${action} completed` },
      error: (e) => ({ title: e.message }),
    })
    await promise
  }
  const projects = projectsQuery.data || []
  const filteredProjects = projects.filter((project) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return [project.name, project.has_compose ? 'compose' : 'no compose'].join(' ').toLowerCase().includes(q)
  })
  const columns = useMemo(() => [
    { key: 'name', label: 'Project Name', accent: true },
    { key: 'has_compose', label: 'Compose Config', render: (item) => item.has_compose ? 'Yes' : 'No' },
  ], [])
  const { columnConfig, setColumnConfig, visibleColumns } = useColumnVisibility(columns, 'projects_cols')

  return (
    <div className="page">
      <div className="instances-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 className="page-title">Projects</h1>
        </div>
      </div>

      <div className="instances-controls" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <TableToolbar
          query={query}
          onQueryChange={setQuery}
          placeholder="Search projects..."
          columnConfig={columnConfig}
          setColumnConfig={setColumnConfig}
          style={{ width: 'clamp(280px, 34vw, 460px)' }}
        />
      </div>

      {projectsQuery.isLoading ? (
        <ContainerDataTable
          items={[0, 1, 2]}
          columns={[
            { key: 'name', label: 'Project Name', render: (_, __, i) => <div className="skeleton" style={{ width: i === 0 ? '160px' : i === 1 ? '190px' : '140px', height: '14px', borderRadius: '4px' }} /> },
            { key: 'has_compose', label: 'Compose Config', render: (_, __, i) => <div className="skeleton" style={{ width: i === 1 ? '45px' : '55px', height: '14px', borderRadius: '4px' }} /> },
          ]}
          renderActions={() => (
            <div style={{ display: 'inline-flex', gap: 5 }}>
              <div className="skeleton" style={{ width: '26px', height: '26px', borderRadius: '6px' }} />
              <div className="skeleton" style={{ width: '26px', height: '26px', borderRadius: '6px' }} />
              <div className="skeleton" style={{ width: '26px', height: '26px', borderRadius: '6px' }} />
              <div className="skeleton" style={{ width: '26px', height: '26px', borderRadius: '6px' }} />
            </div>
          )}
        />
      ) : (
        <ContainerDataTable
          items={filteredProjects}
          empty={
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ marginBottom: 16 }}>
                <Boxes size={48} opacity={0.2} style={{ margin: '0 auto' }} />
              </div>
              <h3 style={{ color: 'var(--text-primary)', marginBottom: 8, fontSize: '1.1rem', fontWeight: 600 }}>No projects found</h3>
              <p style={{ maxWidth: 400, margin: '0 auto 24px', lineHeight: 1.5, fontSize: '0.9rem' }}>
                Eve automatically detects Docker Compose projects placed in your local workspace.
              </p>
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '16px', borderRadius: '8px', display: 'inline-block', textAlign: 'left', fontSize: '0.85rem', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                <span style={{ color: '#a78bfa' }}>mkdir</span> -p projects/my-app<br/>
                <span style={{ color: '#a78bfa' }}>touch</span> projects/my-app/docker-compose.yml
              </div>
            </div>
          }
          columns={visibleColumns}
          renderActions={(item) => (
            <div style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
              <ResourceActionButton icon={<Play size={14} />} label="Up" color="var(--running)" onClick={() => runAction(item.name, 'up')} />
              <ResourceActionButton icon={<Square size={14} />} label="Down" color="var(--stopped)" onClick={() => runAction(item.name, 'down')} />
              <ResourceActionButton icon={<RefreshCw size={14} />} label="Restart" color="#a78bfa" onClick={() => runAction(item.name, 'restart')} />
              <ResourceActionButton icon={<FileText size={14} />} label="Edit YAML" color="#60a5fa" onClick={() => setSelectedProject(item.name)} />
            </div>
          )}
        />
      )}

      {selectedProject && (
        <ProjectEditorModal name={selectedProject} onClose={() => setSelectedProject(null)} />
      )}
    </div>
  )
}

function ProjectEditorModal({ name, onClose }) {
  const [tab, setTab] = useState('compose')
  const { data, isLoading } = useQuery({
    queryKey: ['project-compose', name],
    queryFn: () => api.getProjectCompose(name),
    enabled: Boolean(name),
    retry: false,
  })

  const saveMutation = useMutation({
    mutationFn: (payload) => api.updateProjectCompose(name, payload),
    onSuccess: () => {
      toast.success({ title: 'Project configuration saved' })
      onClose()
    },
    onError: (e) => toast.error({ title: e.message }),
  })

  const [composeContent, setComposeContent] = useState('')
  const [envContent, setEnvContent] = useState('')

  // Initialize state once data loads
  useEffect(() => {
    if (!data) return undefined
    const timeout = setTimeout(() => {
      setComposeContent(data.compose || '')
      setEnvContent(data.env || '')
    }, 0)
    return () => clearTimeout(timeout)
  }, [data])

  return (
    <Modal title={`Edit Project · ${name}`} onClose={onClose} size="lg">
      {isLoading ? (
        <p>Loading configuration...</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
            <button
              type="button"
              onClick={() => setTab('compose')}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontWeight: tab === 'compose' ? 600 : 400,
                color: tab === 'compose' ? 'var(--text-primary)' : 'var(--text-muted)'
              }}
            >
              docker-compose.yml
            </button>
            <button
              type="button"
              onClick={() => setTab('env')}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontWeight: tab === 'env' ? 600 : 400,
                color: tab === 'env' ? 'var(--text-primary)' : 'var(--text-muted)'
              }}
            >
              .env
            </button>
          </div>

          {tab === 'compose' && (
            <YamlEditor
              value={composeContent}
              onChange={setComposeContent}
              height="50vh"
            />
          )}

          {tab === 'env' && (
            <textarea
              value={envContent}
              onChange={(e) => setEnvContent(e.target.value)}
              style={{
                height: '50vh',
                width: '100%',
                background: 'var(--bg)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: 12,
                fontFamily: 'monospace',
                fontSize: 13,
                resize: 'none'
              }}
              placeholder="KEY=value"
            />
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
            <button className="btn-ghost" onClick={onClose} disabled={saveMutation.isPending}>
              Cancel
            </button>
            <button
              className="btn-accent"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate({
                compose: composeContent,
                env: envContent
              })}
            >
              {saveMutation.isPending ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
