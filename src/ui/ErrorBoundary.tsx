import { Component, type ErrorInfo, type ReactNode } from 'react';

// Red de seguridad: si un panel revienta al renderizar, en vez de pantalla en
// blanco se muestra este aviso con opción de recargar (el autoguardado
// recupera el último diseño).
interface State {
  error: Error | null;
  info?: string;
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
    const { error, info } = this.state;
    if (!error) return this.props.children;
    const details = `${error.name}: ${error.message}\n${error.stack ?? ''}\n${info ?? ''}`;
    return (
      <div className="crash-overlay">
        <div className="crash-card">
          <h2>😵 Algo salió mal</h2>
          <p>
            ChamVa encontró un error inesperado. Tu trabajo está a salvo: el
            autoguardado conserva el último estado del diseño.
          </p>
          <pre className="crash-details">{error.message}</pre>
          <div className="row">
            <button className="primary" onClick={() => window.location.reload()}>
              ↻ Recargar y recuperar el diseño
            </button>
            <button
              onClick={() => navigator.clipboard?.writeText(details).catch(() => {})}
            >
              📋 Copiar detalles del error
            </button>
          </div>
        </div>
      </div>
    );
  }
}
