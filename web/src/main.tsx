import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './core/tokens.css';
import './core/base.css';
import { initTheme } from './core/theme';
import { App } from './App';

initTheme();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
