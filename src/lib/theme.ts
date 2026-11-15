import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { readableOn } from "./color";
import { useSettings, type FontChoice, type PerfMode } from "./settings";

export const FONT_STACKS: Record<FontChoice, string> = {
  inter: `"Inter Variable", system-ui, sans-serif`,
  system: `"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif`,
  serif: `Georgia, "Times New Roman", serif`,
  mono: `"Cascadia Code", "JetBrains Mono", Consolas, "DejaVu Sans Mono", monospace`,
};

// ───────────── Batterie (Battery Status API : WebView2 / Chromium ; absente sous WebKitGTK) ─────────────
interface BatteryLike { charging: boolean; level: number; addEventListener(t: string, cb: () => void): void }
let bat: { charging: boolean; level: number } | null = null;
const batSubs = new Set<() => void>();
let batStarted = false;
function startBattery() {
  if (batStarted) return;
  batStarted = true;
  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
  nav.getBattery?.().then((b) => {
    const upd = () => { bat = { charging: b.charging, level: b.level }; batSubs.forEach((f) => f()); };
    b.addEventListener("chargingchange", upd);
    b.addEventListener("levelchange", upd);
    upd();
  }).catch(() => {});
}
const subBat = (cb: () => void) => { batSubs.add(cb); return () => { batSubs.delete(cb); }; };

/** Mode de performance réellement appliqué : celui des Réglages, ou « économie » quand l'économie automatique se déclenche (sur batterie / batterie faible) */
export function usePerf(): PerfMode {
  const perf = useSettings((s) => s.motion.perf);
  const auto = useSettings((s) => s.motion.autoEco);
  const b = useSyncExternalStore(subBat, () => bat);
  useEffect(() => { if (auto !== "off") startBattery(); }, [auto]);
  if (perf === "economy") return perf;
  const eco = !!b && !b.charging && (auto === "battery" || (auto === "low" && b.level <= 0.2));
  return eco ? "economy" : perf;
}

/** Applique thème, accent, transparence, flou, police et accessibilité sur <html> (utilisé par les 5 fenêtres) */
export function useApplyTheme() {
  const theme = useSettings((s) => s.theme);
  const accent = useSettings((s) => s.accent);
  const glass = useSettings((s) => s.glass);
  const blur = useSettings((s) => s.blur);
  const radius = useSettings((s) => s.radius);
  const fx = useSettings((s) => s.glassFx);
  const motion = useSettings((s) => s.motion);
  const font = useSettings((s) => s.font);
  const a11y = useSettings((s) => s.a11y);
  const perf = usePerf();
  const [sysDark, setSysDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const f = () => setSysDark(mq.matches);
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);

  const dark = theme === "auto" ? sysDark : theme === "dark";

  useLayoutEffect(() => {
    const r = document.documentElement;
    r.dataset.theme = dark ? "dark" : "light";
    r.style.setProperty("--accent", accent);
    r.style.setProperty("--accent-fg", readableOn(accent));
    // « Réduire la transparence » : verre quasi opaque et sans flou
    const solid = a11y.solid;
    r.style.setProperty("--glass-a", String(solid ? 0.94 : glass));
    r.style.setProperty("--glass-strong-a", String(solid ? 0.98 : Math.min(0.97, glass + 0.26)));
    // Mode « économie » : flou plafonné et sans saturation (le plus gros coût en GPU)
    const eco = perf === "economy";
    r.style.setProperty("--blur", (solid ? 0 : eco ? Math.min(blur, 10) : blur) + "px");
    r.style.setProperty("--glass-sat", (eco || solid ? 100 : fx.saturate) + "%");
    r.style.setProperty("--border-k", String(fx.border));
    r.style.setProperty("--shadow-k", String(fx.shadow));
    r.style.setProperty("--radius", radius + "px");
    r.style.setProperty("--speed", String(motion.level === "off" ? 1 : motion.speed));
    r.style.setProperty("--font", FONT_STACKS[font]);
    r.dataset.motion = motion.level;
    r.dataset.perf = perf;
    r.dataset.contrast = a11y.contrast ? "1" : "0";
  }, [dark, accent, glass, blur, radius, fx, motion.level, motion.speed, perf, font, a11y]);

  return dark;
}
