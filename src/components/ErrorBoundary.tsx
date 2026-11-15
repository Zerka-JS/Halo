import { Component, type ErrorInfo, type ReactNode } from "react";

/** Écran d'erreur lisible (à la place d'un écran blanc) : le message peut être copié et envoyé pour dépannage */
export function ErrorPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "rgba(14,15,16,.92)", color: "#f1e6d2", font: "13px system-ui, sans-serif", userSelect: "text", zIndex: 99999 }}>
      <div style={{ maxWidth: 760, maxHeight: "90%", overflow: "auto", border: "1px solid rgba(255,255,255,.18)", borderRadius: 14, padding: 18, background: "#1b1e21" }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{title}</div>
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 11.5, lineHeight: 1.45, opacity: 0.9 }}>{detail}</pre>
        <button type="button" onClick={() => navigator.clipboard?.writeText(`${title}\n${detail}`).catch(() => {})}
          style={{ marginTop: 12, padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,.25)", background: "#25292d", color: "inherit", cursor: "pointer" }}>
          Copier l'erreur
        </button>
      </div>
    </div>
  );
}

const describe = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}\n${(e.stack ?? "").split("\n").slice(1, 8).join("\n")}` : String(e));

interface Props { children: ReactNode; mode: "screen" | "widget"; name?: string }
interface State { err: unknown }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { err: null };
  static getDerivedStateFromError(err: unknown): State { return { err }; }
  componentDidCatch(err: unknown, info: ErrorInfo) { console.error("[Halo] erreur d'affichage", err, info.componentStack); }
  render() {
    if (this.state.err == null) return this.props.children;
    const detail = describe(this.state.err);
    if (this.props.mode === "widget") {
      // Un widget cassé ne doit pas faire tomber tout le bureau
      return (
        <div title={detail} style={{ padding: "8px 12px", borderRadius: 12, border: "1px solid rgba(229,72,77,.6)", background: "rgba(40,16,18,.85)", color: "#f1e6d2", font: "11px system-ui, sans-serif", maxWidth: 260 }}>
          Widget « {this.props.name ?? "?"} » en erreur : {String((this.state.err as Error)?.message ?? this.state.err).slice(0, 120)}
        </div>
      );
    }
    return <ErrorPanel title="Halo : une erreur d'affichage est survenue" detail={detail} />;
  }
}
