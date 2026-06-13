import { useMemo } from 'react'

function detectApplePlatform() {
  if (typeof navigator === 'undefined') return true

  const uaDataPlatform = String(navigator.userAgentData?.platform || '').toLowerCase()
  const platform = String(navigator.platform || '').toLowerCase()
  const userAgent = String(navigator.userAgent || '').toLowerCase()
  const combined = `${uaDataPlatform} ${platform} ${userAgent}`

  return /mac|iphone|ipad|ipod/.test(combined)
}

export default function useShortcutPlatform() {
  return useMemo(() => {
    const isApple = detectApplePlatform()
    return {
      isApple,
      modifierKeyDisplay: isApple ? '⌘' : 'Ctrl',
      osLabel: isApple ? 'macOS' : 'Windows/Linux',
    }
  }, [])
}
