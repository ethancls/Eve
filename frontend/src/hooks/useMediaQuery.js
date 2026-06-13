import { useSyncExternalStore } from 'react'

function subscribeQuery(query, onStoreChange) {
  if (typeof window === 'undefined') return () => {}

  const mediaQuery = window.matchMedia(query)
  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', onStoreChange)
    return () => mediaQuery.removeEventListener('change', onStoreChange)
  }

  mediaQuery.addListener(onStoreChange)
  return () => mediaQuery.removeListener(onStoreChange)
}

function getQuerySnapshot(query) {
  if (typeof window === 'undefined') return false
  return window.matchMedia(query).matches
}

export default function useMediaQuery(query) {
  return useSyncExternalStore(
    (onStoreChange) => subscribeQuery(query, onStoreChange),
    () => getQuerySnapshot(query),
    () => false,
  )
}
