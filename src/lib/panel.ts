import type { CSSProperties } from "react";
import type { PanelBg } from "./settings";

/** Fond d'une barre (barre du haut, dock) : verre (par défaut), opaque ou transparent.
 *  Se combine avec la classe `glass`, qui fournit le verre ; ces styles ne font que le remplacer. */
export function panelStyle(bg: PanelBg): CSSProperties | undefined {
  if (bg === "solid") return { background: "var(--surface)", backdropFilter: "none", WebkitBackdropFilter: "none" };
  if (bg === "none") {
    return { background: "transparent", borderColor: "transparent", boxShadow: "none", backdropFilter: "none", WebkitBackdropFilter: "none", textShadow: "0 1px 3px rgb(0 0 0 / .55)" };
  }
  return undefined;
}
