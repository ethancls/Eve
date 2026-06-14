import { Github } from 'lucide-react'

export function RegistryProviderIcon({ provider, size = 14 }) {
  if (provider === 'ghcr.io') {
    return <Github size={size} strokeWidth={2.2} />
  }

  return (
    <img
      src="/images/docker.svg"
      alt=""
      width={size}
      height={size}
      style={{ display: 'block', width: size, height: size, objectFit: 'contain' }}
    />
  )
}
