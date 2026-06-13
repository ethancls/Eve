import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export default function Tooltip({ label, children, className = '', style }) {
  const wrapRef = useRef(null)
  const bubbleRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0, placement: 'top' })

  const updatePosition = useCallback(() => {
    if (!wrapRef.current) return
    const rect = wrapRef.current.getBoundingClientRect()
    const bubbleRect = bubbleRef.current?.getBoundingClientRect()
    const bubbleWidth = bubbleRect?.width ?? 0
    const bubbleHeight = bubbleRect?.height ?? 0
    const margin = 8

    let left = rect.left + (rect.width / 2)
    if (bubbleWidth > 0) {
      const minLeft = (bubbleWidth / 2) + margin
      const maxLeft = window.innerWidth - (bubbleWidth / 2) - margin
      left = Math.min(Math.max(left, minLeft), maxLeft)
    }

    const canPlaceTop = rect.top - bubbleHeight - margin >= margin
    setPosition({
      left,
      top: canPlaceTop ? rect.top - margin : rect.bottom + margin,
      placement: canPlaceTop ? 'top' : 'bottom',
    })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    let frame = requestAnimationFrame(updatePosition)

    const onViewportChange = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(updatePosition)
    }
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [open, label, updatePosition])

  if (!label) return children

  return (
    <span
      ref={wrapRef}
      className={`app-tooltip-wrap${className ? ` ${className}` : ''}`}
      style={style}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false)
      }}
    >
      {children}
      {open && typeof document !== 'undefined' && createPortal(
        <span
          ref={bubbleRef}
          className={`app-tooltip-bubble app-tooltip-bubble--${position.placement}`}
          role="tooltip"
          style={{ left: position.left, top: position.top }}
        >
          {label}
        </span>,
        document.body,
      )}
    </span>
  )
}
