import { useEffect, useRef, useState } from "react";
import { Battery, BatteryCharging, BatteryLow, BatteryMedium, ChevronUp, ExternalLink, Hexagon, LayoutGrid, Lock, LogOut, Moon, Music, Palette, PanelBottom, Pause, Play, Power, RotateCcw,
         SkipBack, SkipForward, Search, SlidersHorizontal, Sun, Volume1, Volume2, VolumeX, Wifi, WifiOff, X } from "lucide-react";
import { call, send } from "../lib/tauri";
import { updateSettings, useSettings } from "../lib/settings";
import { fmtDate, fmtTime, useNow } from "../lib/clock";
import { panelStyle } from "../lib/panel";
import { useGlobalShortcuts } from "../lib/shortcuts";
import { mediaCmd, setVolume, toggleMute, useAudioDeviceSync, useAudioDevices, useMedia, useVolume } from "../lib/sys";
import { useSystemStatus } from "../hooks/useSystemStatus";
import { useBackgroundApps } from "../hooks/useBackgroundApps";

// La liste des applications en arrière-plan repose sur Windows
const IS_WIN = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);

function Slider({ icon, label, value, onChange, onIcon }: { icon: React.ReactNode; label: string; value: number; onChange: (v: number) => void; onIcon?: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: "var(--glass)" }}>
      <button type="button" onClick={onIcon} disabled={!onIcon} aria-label={onIcon ? `${label} : couper / rétablir` : label} className="mono-dim">{icon}</button>
      <input type="range" min={0} max={100} value={value} aria-label={label} onChange={(e) => onChange(+e.target.value)}
        className="halo-range flex-1" style={{ ["--p" as string]: `${value}%` }} />
    </div>
  );
}

function Item({ icon, label, onClick, active }: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-white/10"
      style={active ? { background: "var(--accent)", color: "var(--accent-fg)" } : undefined}>{icon}{label}</button>
  );
}

// Écran secondaire (?m=1…) : la barre y est identique, mais seul l'écran principal enregistre les raccourcis globaux
const SECONDARY = new URLSearchParams(location.search).has("m");
const keyName = (a: string) => a.replace("Space", "Espace").replace(/\+/g, " + ");

function Shortcuts() { useGlobalShortcuts(); useAudioDeviceSync(); return null; }

export default function TopBar() {
  const t = useSettings((s) => s.topbar);
  const c = useSettings((s) => s.clock);
  const theme = useSettings((s) => s.theme);
  const hideTaskbar = useSettings((s) => s.hideTaskbar);
  const hideFull = useSettings((s) => s.autoHideFullscreen);
  const hideMax = useSettings((s) => s.autoHideMaximized);
  const statusEvery = useSettings((s) => s.refresh.status);
  const searchKey = useSettings((s) => s.shortcuts.search);
  const status = useSystemStatus(Math.round(statusEvery * 1000));
  const vol = useVolume();
  const outDev = useAudioDevices().selected;
  const media = useMedia();
  const now = useNow(c.seconds);
  const [open, setOpen] = useState<null | "halo" | "cc" | "power" | "bg">(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [armedBg, setArmedBg] = useState<string | null>(null);
  const bg = useBackgroundApps(open === "bg");
  const [bright, setBright] = useState<number | null>(null);
  const brightTimer = useRef(0);
  const applied = useRef(true);

  useEffect(() => { call("set_topbar_expanded", { expanded: open !== null }); }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest("[data-pop]")) setOpen(null); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  useEffect(() => {
    if (open === "cc") call<number | null>("get_brightness").then((b) => setBright(typeof b === "number" ? b : null));
  }, [open]);
  // Applique l'état enregistré de la barre Windows (Rust démarre en mode "masquée")
  useEffect(() => {
    if (applied.current === hideTaskbar) return;
    applied.current = hideTaskbar;
    call("set_shell_mode", { enabled: hideTaskbar });
  }, [hideTaskbar]);
  // Plein écran (jeu, vidéo, F11) : la barre du haut et le dock s'effacent sur l'écran concerné
  useEffect(() => { call("set_fullscreen_hide", { enabled: hideFull }); }, [hideFull]);
  // Fenêtre simplement agrandie : mêmes barres masquées (la souris contre le bord du haut / du bas les rappelle)
  useEffect(() => { call("set_hide_maximized", { enabled: hideMax }); }, [hideMax]);

  const setBrightness = (v: number) => {
    setBright(v);
    clearTimeout(brightTimer.current);
    brightTimer.current = window.setTimeout(() => call("set_brightness", { level: v }), 120);
  };
  const act = (fn: () => void) => () => { setOpen(null); fn(); };
  // Alimentation : arrêter / redémarrer / se déconnecter demandent un second clic pour confirmer
  useEffect(() => { if (open !== "power") setArmed(null); }, [open]);
  useEffect(() => { if (open !== "bg") setArmedBg(null); }, [open]);
  // Fermer une application en arrière-plan demande un second clic pour confirmer
  const quitBg = (path: string) => {
    if (armedBg !== path) { setArmedBg(path); return; }
    setArmedBg(null);
    bg.drop(path);
    call("quit_background", { path });
  };
  const power = (action: string, confirm: boolean) => () => {
    if (confirm && t.confirmPower && armed !== action) { setArmed(action); return; }
    setOpen(null);
    call("power_action", { action });
  };

  const B = status.charging ? BatteryCharging : (status.battery ?? 100) > 60 ? Battery : (status.battery ?? 100) > 25 ? BatteryMedium : BatteryLow;
  const V = vol.mute || vol.vol === 0 ? VolumeX : vol.vol < 0.4 ? Volume1 : Volume2;
  const date = c.date ? fmtDate(now, c) : "";
  const time = fmtTime(now, c);
  const ico = Math.round(t.size * 1.15);
  const volPct = vol.mute ? 0 : Math.round(vol.vol * 100);

  return (
    <div className="h-full w-full">
      {!SECONDARY && <Shortcuts />}
      <header className="glass relative flex h-8 w-full items-center justify-between rounded-none border-x-0 border-t-0 px-3" style={{ fontSize: t.size, ...panelStyle(t.bg) }}>
        <div className="relative" data-pop>
          <button type="button" aria-expanded={open === "halo"} aria-haspopup="menu" onClick={() => setOpen((o) => (o === "halo" ? null : "halo"))}
            className="flex items-center gap-2 rounded-md px-1.5 py-0.5 font-semibold transition-colors hover:bg-white/10"><Hexagon size={ico} strokeWidth={2.2} />{t.label ? "Halo" : <span className="sr-only">Halo</span>}</button>
          {open === "halo" && (
            <div role="menu" aria-label="Menu Halo" className="glass glass-strong absolute left-0 top-9 w-60 rounded-[var(--radius)] p-1.5">
              <Item icon={<SlidersHorizontal size={15} />} label="Réglages de Halo…" onClick={act(() => call("open_settings", { page: "appearance" }))} />
              <Item icon={<Palette size={15} />} label="Fond d'écran…" onClick={act(() => call("open_settings", { page: "wallpaper" }))} />
              <Item icon={<PanelBottom size={15} />} label="Organiser le dock…" onClick={act(() => call("open_settings", { page: "dock" }))} />
              <Item icon={<LayoutGrid size={15} />} label="Modifier les widgets" onClick={act(() => send("halo-edit-widgets", true))} />
              <div className="my-1 h-px" style={{ background: "var(--stroke)" }} />
              <Item icon={<Power size={15} />} label="Quitter Halo" onClick={() => call("quit")} />
            </div>
          )}
        </div>

        <div className="relative flex items-center" style={{ gap: t.gap }} data-pop>
          {t.search && (
            <button type="button" onClick={() => call("open_search")} aria-label={`Rechercher une application${searchKey ? ` (${keyName(searchKey)})` : ""}`}
              title={searchKey ? `Rechercher (${keyName(searchKey)})` : "Rechercher"} className="rounded-md p-1 transition-colors hover:bg-white/10"><Search size={ico} /></button>
          )}
          {IS_WIN && t.background && (
            <button type="button" onClick={() => setOpen((o) => (o === "bg" ? null : "bg"))} aria-expanded={open === "bg"} aria-haspopup="dialog"
              aria-label="Applications en arrière-plan" title="Applications en arrière-plan" className="rounded-md p-1 transition-colors hover:bg-white/10">
              <ChevronUp size={ico} style={{ transform: open === "bg" ? "rotate(180deg)" : undefined, transition: "transform .15s" }} /></button>
          )}
          {t.network && (status.network ? <Wifi size={ico} aria-label="Réseau connecté" /> : <WifiOff size={ico} aria-label="Hors ligne" />)}
          {t.volume && (
            <button type="button" onClick={() => setOpen("cc")} aria-label={`Volume ${volPct} %`} title={`Volume ${volPct} %${outDev ? " · " + outDev : ""}`} className="rounded-md p-1 transition-colors hover:bg-white/10"
              onWheel={t.wheelVolume ? (e) => setVolume(vol.vol - Math.sign(e.deltaY) * 0.04) : undefined}><V size={ico} /></button>
          )}
          {t.battery && status.battery !== null && <span className="flex items-center gap-1 tabular-nums"><B size={ico + 2} aria-label={`Batterie ${status.battery} %`} />{t.batteryPercent && `${status.battery}%`}</span>}
          {t.control && (
            <button type="button" onClick={() => setOpen((o) => (o === "cc" ? null : "cc"))} aria-expanded={open === "cc"} aria-label="Centre de contrôle"
              className="rounded-md p-1 transition-colors hover:bg-white/10"><SlidersHorizontal size={ico} /></button>
          )}
          {t.clock && <span className="font-medium tabular-nums">{date ? date + " " : ""}{time}</span>}
          {t.power && (
            <button type="button" onClick={() => setOpen((o) => (o === "power" ? null : "power"))} aria-expanded={open === "power"} aria-haspopup="menu"
              aria-label="Alimentation" title="Alimentation" className="rounded-md p-1 transition-colors hover:bg-white/10"><Power size={ico} /></button>
          )}

          {open === "bg" && (
            <div role="dialog" aria-label="Applications en arrière-plan" className="glass glass-strong absolute right-0 top-9 w-80 rounded-[var(--radius)] p-1.5">
              <div className="px-2.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide mono-dim">En arrière-plan</div>
              <div className="max-h-[360px] overflow-y-auto">
                {bg.apps === null && <p className="px-2.5 py-3 text-[13px] mono-dim">Recherche des applications…</p>}
                {bg.apps?.length === 0 && <p className="px-2.5 py-3 text-[13px] mono-dim">Aucune application en arrière-plan.</p>}
                {bg.apps?.map((a) => (
                  <div key={a.path} className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-white/10">
                    {bg.icons[a.path]
                      ? <img src={bg.icons[a.path]} alt="" draggable={false} className="h-6 w-6 shrink-0 object-contain" />
                      : <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold" style={{ background: "var(--stroke)" }}>{a.name.charAt(0).toUpperCase()}</span>}
                    <span className="min-w-0 flex-1 truncate text-[13px]" title={a.path}>{a.name}{a.count > 1 && <span className="ml-1.5 text-[11px] mono-dim">×{a.count}</span>}</span>
                    <button type="button" aria-label={`Ouvrir ${a.name}`} title="Ouvrir" onClick={act(() => call("launch", { target: a.path }))} className="rounded-md p-1.5 hover:bg-white/15"><ExternalLink size={14} /></button>
                    <button type="button" aria-label={armedBg === a.path ? `Confirmer : fermer ${a.name}` : `Fermer ${a.name}`} title={armedBg === a.path ? "Cliquer pour confirmer" : "Fermer"} onClick={() => quitBg(a.path)}
                      className="flex items-center gap-1 rounded-md p-1.5 text-[11px] font-medium hover:bg-white/15"
                      style={armedBg === a.path ? { background: "var(--accent)", color: "var(--accent-fg)" } : undefined}>
                      <X size={14} />{armedBg === a.path && "Confirmer"}</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {open === "power" && (
            <div role="menu" aria-label="Alimentation" className="glass glass-strong absolute right-0 top-9 w-64 rounded-[var(--radius)] p-1.5">
              <Item icon={<Lock size={15} />} label="Verrouiller" onClick={power("lock", false)} />
              <Item icon={<Moon size={15} />} label="Mettre en veille" onClick={power("sleep", false)} />
              <div className="my-1 h-px" style={{ background: "var(--stroke)" }} />
              <Item icon={<LogOut size={15} />} label={armed === "logoff" ? "Cliquer pour confirmer" : "Se déconnecter"} active={armed === "logoff"} onClick={power("logoff", true)} />
              <Item icon={<Power size={15} />} label={armed === "shutdown" ? "Cliquer pour confirmer" : "Arrêter"} active={armed === "shutdown"} onClick={power("shutdown", true)} />
              <Item icon={<RotateCcw size={15} />} label={armed === "restart" ? "Cliquer pour confirmer" : "Redémarrer"} active={armed === "restart"} onClick={power("restart", true)} />
            </div>
          )}

          {open === "cc" && (
            <div role="dialog" aria-label="Centre de contrôle" className="glass glass-strong absolute right-0 top-9 grid w-80 gap-2 rounded-[var(--radius)] p-3">
              {t.ccVolume && <Slider icon={<V size={16} />} label="Volume" value={volPct} onChange={(v) => setVolume(v / 100)} onIcon={toggleMute} />}
              {t.ccBrightness && bright !== null && <Slider icon={<Sun size={16} />} label="Luminosité" value={bright} onChange={setBrightness} />}

              {t.ccMedia && media.on && (
                <div className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: "var(--glass)" }}>
                  {media.art ? <img src={media.art} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <span className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: "var(--stroke)" }}><Music size={18} /></span>}
                  <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-semibold">{media.title}</div><div className="truncate text-[11px] mono-dim">{media.artist}</div></div>
                  <button type="button" aria-label="Précédent" onClick={() => mediaCmd("prev")} className="rounded-full p-1.5 hover:bg-white/10"><SkipBack size={15} fill="currentColor" /></button>
                  <button type="button" aria-label={media.playing ? "Pause" : "Lecture"} onClick={() => mediaCmd("toggle")} className="rounded-full p-1.5 hover:bg-white/10">{media.playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button>
                  <button type="button" aria-label="Suivant" onClick={() => mediaCmd("next")} className="rounded-full p-1.5 hover:bg-white/10"><SkipForward size={15} fill="currentColor" /></button>
                </div>
              )}

              {t.ccTheme && (
                <button type="button" onClick={() => updateSettings((s) => ({ ...s, theme: s.theme === "light" ? "dark" : "light" }))}
                  className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-[13px] font-medium" style={{ background: "var(--glass)" }}>
                  {theme === "light" ? <Sun size={16} /> : <Moon size={16} />}{theme === "light" ? "Thème clair" : "Thème sombre"}</button>
              )}
              {t.ccTaskbar && (
                <button type="button" onClick={() => updateSettings((s) => ({ ...s, hideTaskbar: !s.hideTaskbar }))} aria-pressed={hideTaskbar}
                  className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-[13px] font-medium"
                  style={{ background: hideTaskbar ? "var(--text)" : "var(--glass)", color: hideTaskbar ? "var(--ink)" : "var(--text)" }}>
                  <PanelBottom size={16} />Masquer la barre Windows</button>
              )}
              {t.ccSettings && (
                <button type="button" onClick={act(() => call("open_settings", { page: "appearance" }))} className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-[13px] font-medium" style={{ background: "var(--glass)" }}>
                  <SlidersHorizontal size={16} />Réglages de Halo…</button>
              )}
              {t.ccQuit && (
                <button type="button" onClick={() => call("quit")} className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-[13px] font-medium" style={{ background: "var(--glass)" }}>
                  <Power size={16} />Quitter Halo</button>
              )}
            </div>
          )}
        </div>
      </header>
    </div>
  );
}
