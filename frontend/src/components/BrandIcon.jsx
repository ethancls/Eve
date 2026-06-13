import { Box, Server, HardDrive, Cpu, Terminal, Database, Network } from 'lucide-react'

export default function BrandIcon({ name = '', type = 'image', size = 14, color = 'var(--accent)' }) {
  const n = name.toLowerCase()
  let src = null

  // Brand mappings
  if (n.includes('docker')) src = '/images/docker.svg'
  if (n.includes('jellyfin')) src = '/images/jellyfin.png'
  if (n.includes('minikube')) src = '/images/minikube.png'
  if (n.includes('openid') || n.includes('oidc')) src = '/images/openid.png'

  if (src) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: size, height: size }}>
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      </div>
    )
  }

  // Fallbacks based on type
  if (type === 'machine') return <Server size={size} color={color} />
  if (type === 'container') return <Box size={size} color={color} />
  if (type === 'volume') return <Database size={size} color={color} />
  if (type === 'network') return <Network size={size} color={color} />
  if (type === 'cpu') return <Cpu size={size} color={color} />
  if (type === 'terminal') return <Terminal size={size} color={color} />

  return <Box size={size} color={color} />
}
