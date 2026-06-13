import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { driver } from 'driver.js'
import { Compass, X } from 'lucide-react'
import 'driver.js/dist/driver.css'

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function waitForElement(selector, timeout = 3000) {
  return new Promise((resolve) => {
    const start = Date.now()
    const tick = () => {
      const node = document.querySelector(selector)
      if (node) {
        resolve(node)
        return
      }
      if (Date.now() - start >= timeout) {
        resolve(null)
        return
      }
      window.setTimeout(tick, 80)
    }
    tick()
  })
}

const DESKTOP_STEPS = [
  {
    selector: '[data-tour="dashboard-search"]',
    route: '/dashboard',
    title: 'Global search',
    description: 'Search pages, instances, settings, images, snapshots and networks from one place.',
    side: 'bottom',
  },
  {
    selector: '[data-tour="new-instance-primary"]',
    route: '/dashboard',
    title: 'Create a VM',
    description: 'Use this primary action to launch a new instance.',
    side: 'bottom',
  },
  {
    selector: '[data-tour="nav-instances"]',
    route: '/dashboard',
    title: 'Instances',
    description: 'Open all virtual machines, inspect status and jump to details.',
    side: 'right',
  },
  {
    selector: '[data-tour="nav-networks"]',
    route: '/dashboard',
    title: 'Networks',
    description: 'Manage network interfaces and switch bridge settings quickly.',
    side: 'right',
  },
  {
    selector: '[data-tour="nav-settings"]',
    route: '/dashboard',
    title: 'Settings',
    description: 'Configure OIDC, defaults, shortcuts and platform options.',
    side: 'right',
  },
]

const MOBILE_STEPS = [
  {
    selector: '[data-tour="mobile-topbar-title"]',
    route: '/dashboard',
    title: 'Current page',
    description: 'The page title stays visible in the topbar on mobile.',
    side: 'bottom',
  },
  {
    selector: '[data-tour="new-instance-topbar"]',
    route: '/dashboard',
    title: 'Quick create',
    description: 'Tap + to create a new instance from anywhere.',
    side: 'bottom',
  },
  {
    selector: '[data-tour="mobile-menu-toggle"]',
    route: '/dashboard',
    title: 'Navigation drawer',
    description: 'Use this button to open the sidebar menu.',
    side: 'bottom',
    closeDrawer: true,
  },
  {
    selector: '[data-tour="nav-instances"]',
    route: '/dashboard',
    title: 'Instances',
    description: 'Browse and manage all instances.',
    side: 'right',
    openDrawer: true,
  },
  {
    selector: '[data-tour="nav-networks"]',
    route: '/dashboard',
    title: 'Networks',
    description: 'Access network and bridge-related configuration here.',
    side: 'right',
    openDrawer: true,
  },
  {
    selector: '[data-tour="nav-settings"]',
    route: '/dashboard',
    title: 'Settings',
    description: 'Open auth, OIDC and advanced app settings.',
    side: 'right',
    openDrawer: true,
  },
  {
    selector: '[data-tour="mobile-theme-toggle"]',
    route: '/dashboard',
    title: 'Theme mode',
    description: 'Switch quickly between dark, light and system mode.',
    side: 'right',
    openDrawer: true,
  },
]

export default function GuidedTour({ isMobile, setMobileNavOpen }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [running, setRunning] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const driverRef = useRef(null)
  const transitionRef = useRef(false)
  const steps = useMemo(() => (isMobile ? MOBILE_STEPS : DESKTOP_STEPS), [isMobile])

  const stopTour = useCallback(() => {
    setRunning(false)
    setStepIndex(0)
    setMobileNavOpen(false)
    transitionRef.current = false
    if (driverRef.current) {
      driverRef.current.destroy()
      driverRef.current = null
    }
  }, [setMobileNavOpen])

  useEffect(() => {
    if (!running) return undefined

    const step = steps[stepIndex]
    if (!step) {
      return undefined
    }

    let cancelled = false

    const goToStep = (nextIndex) => {
      transitionRef.current = true
      if (driverRef.current) {
        driverRef.current.destroy()
        driverRef.current = null
      }
      if (nextIndex < 0) {
        transitionRef.current = false
        return
      }
      if (nextIndex >= steps.length) {
        stopTour()
        return
      }
      setStepIndex(nextIndex)
    }

    const runStep = async () => {
      if (step.route && location.pathname !== step.route) {
        navigate(step.route, { state: { from: location.pathname } })
        await wait(130)
      }

      if (step.openDrawer) {
        setMobileNavOpen(true)
        await wait(130)
      } else if (step.closeDrawer) {
        setMobileNavOpen(false)
        await wait(90)
      }

      const target = await waitForElement(step.selector, 3400)
      if (cancelled) return

      if (!target) {
        goToStep(stepIndex + 1)
        return
      }

      const tourDriver = driver({
        allowClose: true,
        animate: true,
        smoothScroll: true,
        showProgress: true,
        stagePadding: 8,
        overlayOpacity: 0.8,
        popoverClass: 'guided-tour-popover',
        onNextClick: () => goToStep(stepIndex + 1),
        onPrevClick: () => goToStep(stepIndex - 1),
        onCloseClick: () => {
          if (transitionRef.current) {
            transitionRef.current = false
            return
          }
          stopTour()
        },
        steps: [
          {
            element: target,
            popover: {
              title: step.title,
              description: step.description,
              side: step.side || 'bottom',
              align: 'start',
              showButtons: ['previous', 'next', 'close'],
              nextBtnText: stepIndex >= steps.length - 1 ? 'Finish' : 'Next',
              prevBtnText: 'Back',
              progressText: `${stepIndex + 1} / ${steps.length}`,
            },
          },
        ],
      })

      transitionRef.current = false
      driverRef.current = tourDriver
      tourDriver.drive()
    }

    runStep()

    return () => {
      cancelled = true
    }
  }, [running, stepIndex, steps, location.pathname, navigate, setMobileNavOpen, stopTour])

  useEffect(() => () => {
    if (driverRef.current) {
      driverRef.current.destroy()
      driverRef.current = null
    }
  }, [])

  return (
    <button
      type="button"
      className={`guided-tour-fab${running ? ' is-active' : ''}`}
      aria-label={running ? 'Close guided tour' : 'Start guided tour'}
      title={running ? 'Close guided tour' : 'Guided tour'}
      onClick={() => {
        if (running) {
          stopTour()
          return
        }
        navigate('/dashboard', { state: { from: location.pathname } })
        setRunning(true)
        setStepIndex(0)
      }}
    >
      {running ? <X size={20} /> : <Compass size={20} />}
    </button>
  )
}
