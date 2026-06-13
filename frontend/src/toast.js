import { sileo } from 'sileo'

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => {
    const buttons = document.querySelectorAll('[data-sileo-button]')
    const button = buttons[buttons.length - 1]
    if (button && button.textContent === 'Copy') {
      button.textContent = 'Copied ✓'
      button.style.transition = 'all 0.2s ease'
      setTimeout(() => {
        button.textContent = 'Copy'
        button.style.transition = ''
      }, 1200)
    }
  }).catch(() => {})
}

function withCopyButton(opts) {
  if (typeof opts === 'string') {
    opts = { title: opts }
  }
  const text = [opts.title, opts.description].filter(Boolean).join('\n')
  if (!text || opts.button) return opts
  return {
    ...opts,
    button: { title: 'Copy', onClick: () => copyText(text) },
  }
}

const toast = {
  show: (opts) => sileo.show(opts),
  success: (opts) => sileo.success(opts),
  error: (opts) => sileo.error(withCopyButton(opts)),
  warning: (opts) => sileo.warning(withCopyButton(opts)),
  info: (opts) => sileo.info(opts),
  action: (opts) => sileo.action(opts),
  promise: (promise, opts) =>
    sileo.promise(promise, {
      ...opts,
      error: (e) => {
        const base = typeof opts.error === 'function' ? opts.error(e) : opts.error
        return withCopyButton(base || { title: e?.message || 'Error' })
      },
    }),
  dismiss: (id) => sileo.dismiss(id),
  clear: (pos) => sileo.clear(pos),
}

export { sileo, toast }
