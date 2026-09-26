import { render } from 'preact';
import '../../styles.css';
import { App } from './App';

// Radix Colors ships light and dark as separate rule sets keyed on a class, not
// a media query, so following the system is an explicit toggle. That is the
// decision recorded in docs/DECISIONS.md.
const dark = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = (isDark: boolean) => {
  document.documentElement.classList.toggle('dark-theme', isDark);
};
applyTheme(dark.matches);
dark.addEventListener('change', (e) => applyTheme(e.matches));

const root = document.getElementById('root');
if (root) render(<App />, root);
