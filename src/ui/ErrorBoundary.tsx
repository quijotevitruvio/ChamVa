import { Component, type ErrorInfo, type ReactNode } from 'react';
import { APP_VERSION, AUTHOR } from '../branding';
import { getLang, t } from '../i18n';
import { getTheme } from '../theme';
import { useEditor } from '../editor/state/store';
import './a11y.css';
import { openExternal } from '../io/openExternal';
import { buildReport, getConsoleLines, installErrorCapture, issueUrl, redact } from '../io/errorReport';

// Guarda las últimas líneas de console.error para el informe.
installErrorCapture();

// Red de seguridad: si un panel revienta al renderizar, en vez de pantalla en
// blanco se muestra este aviso con opción de recargar (el autoguardado
// recupera el último diseño).
interface State {
  error: Error | null;
  info?: string;
  copied?: boolean;
}

// Informe sin contenido del diseño: solo versión, entorno y contadores.
function makeReport(error: Error, info?: string): string {
  let layers = 0;
  let pages = 0;
  try {
    const st = useEditor.getState();
    pages = st.pages.length;
    layers = st.pages.reduce((n, p, i) => n + (i === st.pageIndex ? st.doc : p).layers.length, 0);
  } catch {
    /* el store puede no estar disponible */
  }
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return buildReport({
    version: APP_VERSION,
    userAgent: navigator.userAgent,
    lang: getLang(),
    theme: getTheme(),
    layers,
    pages,
    memoryMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : undefined,
    errorName: error.name,
    errorMessage: error.message,
    stack: error.stack,
    componentStack: info,
    consoleLines: getConsoleLines(),
  });
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error de interfaz:', error, info.componentStack);
    this.setState({ info: info.componentStack ?? undefined });
  }

  render() {
    const { error, info, copied } = this.state;
    if (!error) return this.props.children;
    const report = () => makeReport(error, info);
    return (
      <div className="crash-overlay">
        <div className="crash-card">
          <h2>😵 {t('Algo salió mal')}</h2>
          <p>
            ChamVa encontró un error inesperado. Tu trabajo está a salvo: el
            autoguardado conserva el último estado del diseño.
          </p>
          <pre className="crash-details">{redact(error.message)}</pre>
          <div className="row">
            <button className="primary" onClick={() => window.location.reload()}>
              ↻ Recargar y recuperar el diseño
            </button>
            <button
              onClick={() =>
                navigator.clipboard
                  ?.writeText(report())
                  .then(() => this.setState({ copied: true }))
                  .catch(() => {})
              }
            >
              {copied ? '✓ ' : '📋 '}
              {copied ? t('Informe copiado') : t('Copiar informe del error')}
            </button>
            <button onClick={() => openExternal(issueUrl(AUTHOR.repo, error.message, report()))}>
              ↗ {t('Abrir incidencia en GitHub')}
            </button>
          </div>
          <p className="crash-note">
            {t('El informe no incluye tu diseño ni datos personales.')}
          </p>
        </div>
      </div>
    );
  }
}
