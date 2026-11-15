import { useCallback, useEffect, useRef, useState } from "react";
import { call } from "../lib/tauri";

export interface BgApp { name: string; path: string; count: number }

/** Applications en arrière-plan (sans fenêtre) : interrogées seulement tant que le menu est ouvert */
export function useBackgroundApps(active: boolean) {
  const [apps, setApps] = useState<BgApp[] | null>(null);
  const [icons, setIcons] = useState<Record<string, string>>({});
  const asked = useRef(new Set<string>());

  useEffect(() => {
    if (!active) return;
    let alive = true, timer = 0;
    const loop = async () => {
      const list = await call<BgApp[]>("list_background");
      if (!alive) return;
      if (list) {
        const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
        setApps((p) => (JSON.stringify(p) === JSON.stringify(sorted) ? p : sorted));
        for (const a of sorted) {
          if (asked.current.has(a.path)) continue;
          asked.current.add(a.path);
          call<string | null>("app_icon", { path: a.path }).then((b) => { if (b && alive) setIcons((p) => ({ ...p, [a.path]: `data:image/png;base64,${b}` })); });
        }
      } else setApps((p) => p ?? []);
      timer = window.setTimeout(loop, 4000); // pas de requêtes qui se chevauchent
    };
    loop();
    return () => { alive = false; clearTimeout(timer); };
  }, [active]);

  /** Retire tout de suite une application de la liste (après l'avoir fermée) */
  const drop = useCallback((path: string) => setApps((p) => p && p.filter((a) => a.path !== path)), []);
  return { apps, icons, drop };
}
