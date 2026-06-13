import { useContext } from 'react'
import { ThemeContext } from './themeContextObject'

export function useTheme() {
  return useContext(ThemeContext)
}
