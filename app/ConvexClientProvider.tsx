"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { Component } from "react";
import type { ReactNode } from "react";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
const client = url ? new ConvexReactClient(url) : null;

class BackendErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <main role="alert">
          <h1>No se pudo cargar el tablero</h1>
          <p>No se pudo conectar con la simulación. Comprueba que esté en marcha y vuelve a intentarlo.</p>
          <button type="button" onClick={() => window.location.reload()}>Volver a cargar</button>
        </main>
      );
    }
    return this.props.children;
  }
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (!client) {
    return (
      <main>
        <h1>La simulación aún no está preparada</h1>
        <p>Completa la configuración inicial del proyecto para abrir el tablero.</p>
      </main>
    );
  }
  return <ConvexProvider client={client}><BackendErrorBoundary>{children}</BackendErrorBoundary></ConvexProvider>;
}
