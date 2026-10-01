import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './ui/ErrorBoundary';
// Fuentes empaquetadas (OFL): funcionan sin internet. Solo latín, 400 y 700.
import './fonts.css';
import './view.css';
import './support.css';
import { applyTheme } from './theme';

applyTheme();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
