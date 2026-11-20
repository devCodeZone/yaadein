/**
 * main.tsx — entry point. Loads fonts + styles and mounts <App/>.
 * Fonts come from npm (@fontsource) so they work fully offline.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/fraunces';
import '@fontsource-variable/plus-jakarta-sans';
import './styles/theme.css';
import './styles/app.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
