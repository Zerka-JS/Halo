import type { ReactNode } from "react";

export interface WProps {
  id: string;
  opts: Record<string, unknown>;
  edit: boolean;
}

export type Bg = "glass" | "solid" | "none";

/** Fond d'un widget : verre, opaque ou transparent */
export function Surface({ bg, className = "", style, children, label }: {
  bg: Bg; className?: string; style?: React.CSSProperties; children: ReactNode; label?: string;
}) {
  const cls = bg === "glass" ? "glass" : bg === "solid" ? "border" : "";
  const st: React.CSSProperties = bg === "solid" ? { background: "var(--surface-2)", borderColor: "var(--stroke)", boxShadow: "var(--shadow)" } : {};
  return <section aria-label={label} className={`${cls} ${className}`} style={{ ...st, ...style }}>{children}</section>;
}

export const asBg = (v: unknown, d: Bg): Bg => (v === "glass" || v === "solid" || v === "none" ? v : d);

export function IconBtn({ children, onClick, label, size = 36, solid = false }: {
  children: ReactNode; onClick: () => void; label: string; size?: number; solid?: boolean;
}) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      style={{ width: size, height: size, ...(solid ? { background: "#fff", color: "#111" } : {}) }}
      className={`flex shrink-0 items-center justify-center rounded-full transition-transform active:scale-90 ${solid ? "hover:scale-105" : "hover:bg-white/15"}`}>
      {children}
    </button>
  );
}
