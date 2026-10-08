import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { CloseWindowHost } from './ui/CloseWindowHost';
import { ErrorBoundary } from './ui/ErrorBoundary';
// Fuentes empaquetadas (OFL): funcionan sin internet. Solo latín, 400 y 700.
import './fonts.css';
import './view.css';
import './support.css';
import { applyTheme } from './theme';
import { registerServiceWorker } from './io/pwa';

applyTheme();
registerServiceWorker();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <CloseWindowHost />
  </React.StrictMode>,
);
