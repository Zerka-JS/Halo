import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface AppWin { pid: number; name: string; title: string; path: string }

export function useRunningApps(intervalMs = 2500) {
  const [apps, setApps] = useState<AppWin[]>([]);
  const [icons, setIcons] = useState<Record<string, string>>({});
  const asked = useRef(new Set<string>());

  useEffect(() => {
    let alive = true, timer: number;
    const loop = async () => {
      try {
        const list = await invoke<AppWin[]>("list_windows");
        if (!alive) return;
        setApps((p) => (JSON.stringify(p) === JSON.stringify(list) ? p : list));
        for (const a of list) {
          if (!a.path || asked.current.has(a.path)) continue;
          asked.current.add(a.path);
          invoke<string | null>("app_icon", { path: a.path })
            .then((b) => b && alive && setIcons((p) => ({ ...p, [a.path]: `data:image/png;base64,${b}` })))
            .catch(() => {});
        }
      } catch {}
      if (alive) timer = window.setTimeout(loop, intervalMs); // pas de requêtes qui se chevauchent
    };
    loop();
    return () => { alive = false; clearTimeout(timer); };
  }, [intervalMs]);

  return { apps, icons };
}
