import { useState, useMemo } from 'react'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { yaml as langYaml } from '@codemirror/lang-yaml'
import { linter, lintGutter } from '@codemirror/lint'
import { oneDark } from '@codemirror/theme-one-dark'
import jsyaml from 'js-yaml'
import { useTheme } from '../contexts/useTheme'

/* ── YAML linter ── */
const yamlLintSource = linter(view => {
  const text = view.state.doc.toString()
  if (!text.trim()) return []
  try {
    jsyaml.load(text)
    return []
  } catch (e) {
    const mark = e.mark
    if (!mark) {
      return [{ from: 0, to: Math.max(text.length, 1), severity: 'error', message: e.message }]
    }
    const lineNum = Math.min(mark.line + 1, view.state.doc.lines)
    const line = view.state.doc.line(lineNum)
    const col = Math.min(mark.column, line.length)
    const from = line.from + col
    return [{ from, to: Math.min(from + 1, line.to), severity: 'error', message: e.reason || e.message }]
  }
})

/* ── Dark structural overrides (on top of oneDark) ── */
const darkTheme = EditorView.theme({
  '&':                        { background: '#161616', color: '#abb2bf', borderRadius: '10px' },
  '&.cm-focused':             { outline: 'none' },
  '.cm-content':              { padding: '10px 0', caretColor: '#6fa8ff' },
  '.cm-line':                 { padding: '0 14px' },
  '.cm-gutters':              { background: '#111111', borderRight: '1px solid rgba(255,255,255,0.07)', color: '#444', paddingRight: '2px', borderRadius: '10px 0 0 10px' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px', minWidth: '36px', fontSize: '11px', color: '#444' },
  '.cm-gutter.cm-lineNumbers': { minWidth: '44px' },
  '.cm-activeLine':           { background: 'rgba(255,255,255,0.025)' },
  '.cm-activeLineGutter':     { background: 'rgba(255,255,255,0.025)', color: '#666' },
  '&.cm-focused .cm-cursor': { borderLeftColor: '#6fa8ff' },
  '.cm-selectionBackground':  { background: 'rgba(111,168,255,0.16)' },
  '&.cm-focused .cm-selectionBackground': { background: 'rgba(255,123,220,0.16)' },
  '.cm-lintRange-error':      { backgroundImage: 'none', textDecoration: 'underline wavy #f04747', textDecorationSkipInk: 'none' },
  '.cm-lintRange-warning':    { backgroundImage: 'none', textDecoration: 'underline wavy #ff9f0a' },
  '.cm-gutter.cm-gutter-lint': { width: '16px' },
  '.cm-gutter.cm-gutter-lint .cm-gutterElement': { padding: '0 2px' },
  '.cm-tooltip.cm-tooltip-lint': { background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.10)', borderRadius: '8px', color: '#efefef', fontFamily: "'IBM Plex Mono', monospace", fontSize: '11.5px', padding: '6px 10px', boxShadow: '0 4px 20px rgba(0,0,0,0.35)' },
})

/* ── Light structural theme (no oneDark — uses CodeMirror default highlight) ── */
const lightTheme = EditorView.theme({
  '&':                        { background: '#ffffff', color: '#1a1a1a', borderRadius: '10px' },
  '&.cm-focused':             { outline: 'none' },
  '.cm-content':              { padding: '10px 0', caretColor: '#65a800' },
  '.cm-line':                 { padding: '0 14px' },
  '.cm-gutters':              { background: '#f5f6f9', borderRight: '1px solid rgba(0,0,0,0.07)', color: '#aaaabc', paddingRight: '2px', borderRadius: '10px 0 0 10px' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px', minWidth: '36px', fontSize: '11px', color: '#aaaabc' },
  '.cm-gutter.cm-lineNumbers': { minWidth: '44px' },
  '.cm-activeLine':           { background: 'rgba(0,0,0,0.03)' },
  '.cm-activeLineGutter':     { background: 'rgba(0,0,0,0.03)', color: '#888' },
  '&.cm-focused .cm-cursor': { borderLeftColor: '#65a800' },
  '.cm-selectionBackground':  { background: 'rgba(101,168,0,0.14)' },
  '&.cm-focused .cm-selectionBackground': { background: 'rgba(101,168,0,0.14)' },
  '.cm-lintRange-error':      { backgroundImage: 'none', textDecoration: 'underline wavy #c93030', textDecorationSkipInk: 'none' },
  '.cm-lintRange-warning':    { backgroundImage: 'none', textDecoration: 'underline wavy #c06800' },
  '.cm-gutter.cm-gutter-lint': { width: '16px' },
  '.cm-gutter.cm-gutter-lint .cm-gutterElement': { padding: '0 2px' },
  '.cm-tooltip.cm-tooltip-lint': { background: '#ffffff', border: '1px solid rgba(0,0,0,0.10)', borderRadius: '8px', color: '#1a1a1a', fontFamily: "'IBM Plex Mono', monospace", fontSize: '11.5px', padding: '6px 10px', boxShadow: '0 4px 20px rgba(0,0,0,0.12)' },
})

const BASIC_SETUP = {
  lineNumbers: true,
  foldGutter: false,
  dropCursor: false,
  allowMultipleSelections: false,
  indentOnInput: true,
  syntaxHighlighting: true,
  bracketMatching: false,
  closeBrackets: false,
  autocompletion: false,
  rectangularSelection: false,
  crosshairCursor: false,
  highlightActiveLine: true,
  highlightSelectionMatches: false,
  closeBracketsKeymap: false,
  searchKeymap: false,
  defaultKeymap: true,
  historyKeymap: true,
}

function resolvedIsDark(theme) {
  if (theme === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches
  return theme !== 'light'
}

export default function YamlEditor({ value, onChange, minHeight = 280 }) {
  const { theme } = useTheme()
  const [focused, setFocused] = useState(false)

  const isDark = resolvedIsDark(theme)

  const extensions = useMemo(() => isDark
    ? [langYaml(), lintGutter(), yamlLintSource, oneDark, darkTheme]
    : [langYaml(), lintGutter(), yamlLintSource, lightTheme],
  [isDark])

  const focusBorder  = isDark ? 'rgba(111,168,255,0.45)'  : 'rgba(63,125,255,0.38)'
  const idleBorder   = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'

  return (
    <div
      style={{
        border: `1px solid ${focused ? focusBorder : idleBorder}`,
        borderRadius: 10,
        overflow: 'hidden',
        transition: 'border-color 0.15s',
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme="none"
        basicSetup={BASIC_SETUP}
        minHeight={`${minHeight}px`}
        style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}
      />
    </div>
  )
}
