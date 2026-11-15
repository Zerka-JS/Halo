import { useEffect, useState } from "react";
import { call, inTauri, on, send } from "./tauri";
import { getSettings, updateSettings, useSettings, type ShortcutsCfg } from "./settings";
import { cycleWallpaper } from "./wallpapers";
import { toggleMute } from "./sys";

export interface ShortcutDef { key: keyof ShortcutsCfg; label: string; hint: string; run: () => void }

/** Actions déclenchables par un raccourci global */
export const SHORTCUTS: ShortcutDef[] = [
  { key: "search", label: "Ouvrir la recherche", hint: "Affiche ou masque la recherche d'applications.", run: () => { call("open_search"); } },
  { key: "settings", label: "Ouvrir les réglages", hint: "Affiche la fenêtre des réglages de Halo.", run: () => { call("open_settings", {}); } },
  { key: "widgets", label: "Modifier les widgets", hint: "Active le mode édition du bureau (glisser les widgets).", run: () => send("halo-edit-widgets", true) },
  { key: "nextWallpaper", label: "Fond d'écran suivant", hint: "Passe au fond d'écran suivant de la liste.", run: () => cycleWallpaper(1) },
  { key: "prevWallpaper", label: "Fond d'écran précédent", hint: "Revient au fond d'écran précédent.", run: () => cycleWallpaper(-1) },
  { key: "theme", label: "Basculer clair / sombre", hint: "Alterne entre le thème clair et le thème sombre.", run: () => updateSettings((s) => ({ ...s, theme: s.theme === "light" ? "dark" : "light" })) },
  { key: "mute", label: "Couper / rétablir le son", hint: "Active ou désactive le mode muet de Windows.", run: () => toggleMute() },
];

/** État d'enregistrement de chaque raccourci : « ok » ou « refusé » (déjà pris par une autre application, combinaison réservée…) */
export type ShortcutStatus = Partial<Record<keyof ShortcutsCfg, "ok" | "fail">>;
const STATUS_EVENT = "halo-shortcuts-status", QUERY_EVENT = "halo-shortcuts-query";

// Les enregistrements passent par une file : un « désenregistrer » ne doit jamais doubler un « enregistrer » de la même combinaison
let queue: Promise<unknown> = Promise.resolve();
const enqueue = (fn: () => Promise<void>) => { queue = queue.then(fn, fn); };

/** À appeler dans UNE seule fenêtre (la barre du haut de l'écran principal) : enregistre les raccourcis choisis et suit les changements */
export function useGlobalShortcuts() {
  const cfg = useSettings((s) => s.shortcuts);
  useEffect(() => {
    if (!inTauri) return;
    let alive = true;
    const done: string[] = [];
    const status: ShortcutStatus = {};
    const publish = () => send(STATUS_EVENT, status);
    enqueue(async () => {
      if (!alive) return;
      const { register } = await import("@tauri-apps/plugin-global-shortcut");
      const seen = new Set<string>();
      for (const d of SHORTCUTS) {
        const acc = cfg[d.key];
        if (!acc || !alive) continue;
        if (seen.has(acc)) { status[d.key] = "fail"; continue; } // même combinaison que l'action précédente
        seen.add(acc);
        try {
          await register(acc, (e) => { if (e.state === "Pressed") d.run(); });
          done.push(acc); status[d.key] = "ok";
        } catch { status[d.key] = "fail"; }
      }
      publish();
    });
    const off = on(QUERY_EVENT, publish);
    return () => {
      alive = false; off();
      enqueue(async () => {
        const { unregister } = await import("@tauri-apps/plugin-global-shortcut");
        for (const a of done) await unregister(a).catch(() => {});
      });
    };
  }, [cfg]);
}

/** Pour la page Raccourcis : état d'enregistrement rapporté par la barre du haut */
export function useShortcutStatus(): ShortcutStatus | null {
  const [st, setSt] = useState<ShortcutStatus | null>(null);
  useEffect(() => {
    const off = on<ShortcutStatus>(STATUS_EVENT, setSt);
    send(QUERY_EVENT);
    return off;
  }, []);
  return st;
}

/** Combinaisons utilisées plusieurs fois */
export function duplicateShortcuts(c: ShortcutsCfg): Set<string> {
  const seen = new Set<string>(), dup = new Set<string>();
  for (const d of SHORTCUTS) { const a = c[d.key]; if (!a) continue; if (seen.has(a)) dup.add(a); seen.add(a); }
  return dup;
}

export const shortcutsNow = () => getSettings().shortcuts;
