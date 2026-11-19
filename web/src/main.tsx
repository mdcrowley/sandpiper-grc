import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Order matters: tokens declare the cascade layers, Mantine's styles load into theirs,
// then the core's own styles (unlayered, so they win).
import './core/tokens.css';
import './core/mantine';
import './core/base.css';
import './core/shell.css';
import { initTheme } from './core/theme';
import { App } from './App';

initTheme();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
