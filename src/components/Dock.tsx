import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, Reorder, motion, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react";
import { AppWindow, File, Folder, FolderDown, FolderOpen, Minus, Pin as PinIcon, PinOff, Power, Search, SlidersHorizontal, Trash2,
         type LucideIcon } from "lucide-react";
import { useRunningApps, type AppWin } from "../hooks/useRunningApps";
import { updateSettings, useSettings, type IndicatorStyle, type Pin } from "../lib/settings";
import { panelStyle } from "../lib/panel";
import { PIN_ICONS as ICONS } from "../lib/icons";
import { call } from "../lib/tauri";
import { dockSpring, useMotion } from "../lib/motion";

const OPEN_H = 440;

interface Entry {
  id: string; label: string; icon: LucideIcon; img?: string; running: boolean;
  exe: string; win?: AppWin; pin?: Pin; cand?: Pin; target?: string;
}
interface FileItem { name: string; path: string; dir: boolean }
type Panel = null | { kind: "menu"; id: string; x: number } | { kind: "stack"; x: number };

function DockIcon({ item, mouseX, bouncing, showTip, keep, onClick, onMenu, base, peak, dots, indicator, range, spring, radius }: {
  item: Entry; mouseX: MotionValue<number>; bouncing?: boolean; showTip: boolean; keep?: boolean;
  onClick: (e: React.MouseEvent) => void; onMenu?: (x: number) => void; base: number; peak: number; dots: boolean; indicator: IndicatorStyle;
  range: number; spring: { mass: number; stiffness: number; damping: number }; radius: number;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const distance = useTransform(mouseX, (x) => {
    const r = ref.current?.getBoundingClientRect();
    return x - (r ? r.x + r.width / 2 : 0);
  });
  const size = useSpring(useTransform(distance, [-range, 0, range], [base, peak, base]), spring);
  const glyph = useTransform(size, (s) => s * 0.5);
  const img = useTransform(size, (s) => s * 0.68);
  const Icon = item.icon;

  return (
    <div className="group relative flex flex-col items-center">
      <span className={`glass dock-tip pointer-events-none absolute -top-10 max-w-52 truncate whitespace-nowrap rounded-lg px-2.5 py-1 text-xs ${showTip ? "" : "hidden"}`}>
        {item.label}
      </span>
      <motion.div animate={bouncing ? { y: [0, -26, 0] } : { y: 0 }}
        transition={bouncing ? { duration: 0.55, repeat: Infinity, ease: "easeOut" } : { type: "spring", stiffness: 300, damping: 24 }}>
        <motion.button ref={ref} onClick={onClick} aria-label={item.label} whileTap={{ scale: 0.9 }} {...(keep ? { "data-keep": true } : {})}
          onContextMenu={(e) => { e.preventDefault(); onMenu?.(e.clientX); }}
          style={{ width: size, height: size, background: "var(--glass-strong)", border: "1px solid var(--stroke)", borderRadius: `${radius}%` }}
          className="flex items-center justify-center shadow-lg">
          {item.img
            ? <motion.img src={item.img} alt="" draggable={false} style={{ width: img, height: img }} />
            : <motion.span style={{ width: glyph, height: glyph }}><Icon strokeWidth={1.6} className="h-full w-full" /></motion.span>}
        </motion.button>
      </motion.div>
      <span className="mt-1 h-1 rounded-full" aria-hidden
        style={{
          width: indicator === "bar" ? 14 : 4, transition: "opacity .15s",
          background: dots && item.running ? (indicator === "glow" ? "var(--accent)" : "var(--text)") : "transparent",
          boxShadow: dots && item.running && indicator === "glow" ? "0 0 8px 2px var(--accent)" : undefined,
        }} />
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-white/10"
      style={danger ? { color: "var(--accent)" } : undefined}>{icon}{label}</button>
  );
}

export default function Dock() {
  const dock = useSettings((s) => s.dock);
  const pins = useSettings((s) => s.pins);
  const appsEvery = useSettings((s) => s.refresh.apps);
  const motionCfg = useSettings((s) => s.motion);
  const searchKey = useSettings((s) => s.shortcuts.search);
  const mo = useMotion();
  const { apps, icons } = useRunningApps(Math.round(appsEvery * 1000));
  const mouseX = useMotionValue(Infinity);
  const setPins = (v: Pin[] | ((p: Pin[]) => Pin[])) =>
    updateSettings((s) => ({ ...s, pins: typeof v === "function" ? v(s.pins) : v }));
  const BASE = dock.size, PEAK = dock.magnify ? Math.round(BASE * dock.zoom) : BASE, IDLE_H = PEAK + 70;
  const [panel, setPanel] = useState<Panel>(null);
  const [launching, setLaunching] = useState<Set<string>>(new Set());
  const [downloads, setDownloads] = useState<FileItem[]>([]);
  const dragging = useRef(false);

  // Entrées : épinglées (réordonnables) puis apps ouvertes non épinglées
  const { byPin, extras } = useMemo(() => {
    const used = new Set<string>();
    const byPin = new Map<string, Entry>();
    for (const p of pins) {
      const wins = apps.filter((a) => p.exe.includes(a.name.toLowerCase()));
      wins.forEach((a) => used.add(a.name.toLowerCase()));
      byPin.set(p.id, { id: p.id, label: p.label, icon: ICONS[p.iconKey ?? ""] ?? AppWindow, running: wins.length > 0,
        img: p.img ?? (wins[0] ? icons[wins[0].path] : undefined), exe: p.exe[0], win: wins[0], pin: p, target: p.target });
    }
    const extras: Entry[] = [], seen = new Set<string>();
    for (const a of dock.showRunning ? apps : []) {
      const k = a.name.toLowerCase();
      if (used.has(k) || seen.has(k)) continue;
      seen.add(k);
      const label = a.name.charAt(0).toUpperCase() + a.name.slice(1);
      extras.push({ id: "app-" + k, label: a.title || label, icon: AppWindow, img: icons[a.path], running: true, exe: k, win: a,
        cand: a.path ? { id: "p-" + k, label, exe: [k], target: a.path, img: icons[a.path] } : undefined });
    }
    return { byPin, extras };
  }, [apps, icons, pins, dock.showRunning]);

  const all = useMemo(() => [...byPin.values(), ...extras], [byPin, extras]);

  const fixed = 1 + (dock.search ? 1 : 0) + (dock.settings ? 1 : 0) + (dock.downloads ? 1 : 0) + (dock.trash ? 1 : 0);
  const GAP = dock.gap;
  const W = Math.max(520, (pins.length + extras.length + fixed) * (BASE + GAP) + PEAK + 120);
  const panelOpen = panel !== null, prevOpen = useRef(panelOpen), mounted = useRef(false);
  useEffect(() => {
    // Ouverture / fermeture d'un menu : immédiat. Changement de taille ou d'espacement (curseurs des Réglages) : regroupé,
    // pour ne pas redimensionner la fenêtre du dock à chaque pixel (saccades).
    const instant = !mounted.current || prevOpen.current !== panelOpen;
    mounted.current = true; prevOpen.current = panelOpen;
    // "bar" : hauteur de la barre du dock depuis le bas de l'écran (marge 8 + icônes + point + marges) ; la recherche se pose juste au-dessus
    const t = window.setTimeout(() => { invoke("fit_dock", { width: W, height: panelOpen ? OPEN_H : IDLE_H, bar: BASE + 36 }).catch(() => {}); }, instant ? 0 : 90);
    return () => clearTimeout(t);
  }, [W, IDLE_H, BASE, panelOpen]);

  useEffect(() => {
    const down = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest("[data-panel],[data-keep]")) setPanel(null); };
    const close = () => setPanel(null);
    const noCtx = (e: Event) => e.preventDefault();
    window.addEventListener("mousedown", down);
    window.addEventListener("blur", close);
    window.addEventListener("contextmenu", noCtx);
    return () => { window.removeEventListener("mousedown", down); window.removeEventListener("blur", close); window.removeEventListener("contextmenu", noCtx); };
  }, []);

  const activate = (e: Entry) => {
    if (dragging.current) return;
    setPanel(null);
    if (e.win) { invoke("focus_window", { pid: e.win.pid }); return; }
    if (!e.target) return;
    if (e.target === "halo:search") { call("open_search"); return; }
    if (e.target === "halo:settings") { call("open_settings", { page: "dock" }); return; }
    invoke("launch", { target: e.target });
    setLaunching((s) => new Set(s).add(e.id)); // rebond jusqu'à l'apparition de la fenêtre
    setTimeout(() => setLaunching((s) => { const n = new Set(s); n.delete(e.id); return n; }), 12000);
  };

  const togglePin = (e: Entry) => {
    setPanel(null);
    if (e.pin) setPins((p) => p.filter((x) => x.id !== e.pin!.id));
    else if (e.cand) setPins((p) => [...p, e.cand!]);
  };

  const openStack = async (x: number) => {
    if (panel?.kind === "stack") { setPanel(null); return; }
    const list = await invoke<FileItem[]>("list_downloads").catch(() => [] as FileItem[]);
    setDownloads(list.slice(0, dock.dlCount));
    setPanel({ kind: "stack", x });
  };

  const stack: Entry = { id: "downloads", label: "Téléchargements", icon: FolderDown, running: false, exe: "" };
  const lens: Entry = { id: "halo-search", label: searchKey ? `Rechercher (${searchKey.replace("Space", "Espace").replace(/\+/g, " + ")})` : "Rechercher", icon: Search, running: false, exe: "", target: "halo:search" };
  const cog: Entry = { id: "halo-settings", label: "Réglages de Halo", icon: SlidersHorizontal, running: false, exe: "", target: "halo:settings" };
  const trash: Entry = { id: "trash", label: "Corbeille", icon: Trash2, running: false, exe: "", target: "shell:RecycleBinFolder" };
  const menuEntry = panel?.kind === "menu" ? all.find((e) => e.id === panel.id) : undefined;
  const px = panel ? Math.min(Math.max(panel.x, 150), window.innerWidth - 150) : 0;
  const showTip = panel === null && dock.labels;
  const spring = useMemo(() => dockSpring(dock.spring, motionCfg.level, motionCfg.speed), [dock.spring, motionCfg.level, motionCfg.speed]);
  const sz = { base: BASE, peak: PEAK, dots: dock.indicators, indicator: dock.indicator, range: dock.range, spring, radius: dock.iconRadius };
  const bounce = (e: Entry) => dock.bounce && mo.level === "full" && launching.has(e.id) && !e.running;

  return (
    <div className="relative h-full w-full">
      <AnimatePresence>
        {panel && (
          <motion.div key={panel.kind} data-panel style={{ left: px, bottom: 100, transformOrigin: "bottom" }}
            initial={{ opacity: 0, scale: 0.9, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.92, y: 6 }}
            transition={mo.spring(380, 28)}
            className="glass glass-strong absolute z-10 -translate-x-1/2 rounded-[var(--radius)] p-1.5">
            {menuEntry && (
              <div className="w-52">
                <div className="truncate px-2.5 py-1.5 text-xs font-semibold mono-dim">{menuEntry.label}</div>
                <MenuItem icon={<AppWindow size={15} />} label={menuEntry.win ? "Afficher" : "Ouvrir"} onClick={() => activate(menuEntry)} />
                {menuEntry.win && <MenuItem icon={<Minus size={15} />} label="Réduire" onClick={() => { setPanel(null); invoke("minimize_window", { pid: menuEntry.win!.pid }); }} />}
                {(menuEntry.pin || menuEntry.cand) && (
                  <MenuItem icon={menuEntry.pin ? <PinOff size={15} /> : <PinIcon size={15} />}
                    label={menuEntry.pin ? "Retirer du Dock" : "Garder dans le Dock"} onClick={() => togglePin(menuEntry)} />
                )}
                {menuEntry.win && menuEntry.exe !== "explorer" && (
                  <MenuItem icon={<Power size={15} />} label="Quitter" danger onClick={() => { setPanel(null); invoke("quit_app", { pid: menuEntry.win!.pid }); }} />
                )}
              </div>
            )}
            {panel.kind === "stack" && (
              <div className="w-[330px]">
                <div className="grid grid-cols-3 gap-1">
                  {downloads.length === 0 && <p className="col-span-3 p-4 text-center text-xs mono-dim">Aucun fichier récent</p>}
                  {downloads.map((f) => (
                    <button key={f.path} onClick={() => { setPanel(null); invoke("launch", { target: f.path }); }} title={f.name}
                      className="flex flex-col items-center gap-1.5 rounded-lg p-2 transition-colors hover:bg-white/10">
                      {f.dir ? <Folder size={30} strokeWidth={1.5} /> : <File size={30} strokeWidth={1.5} />}
                      <span className="line-clamp-2 w-full break-all text-center text-[11px] leading-tight">{f.name}</span>
                    </button>
                  ))}
                </div>
                <MenuItem icon={<FolderOpen size={15} />} label="Ouvrir le dossier" onClick={() => { setPanel(null); invoke("launch", { target: "shell:Downloads" }); }} />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute inset-x-0 bottom-2 flex justify-center">
        <motion.nav aria-label="Dock" onMouseMove={(e) => mouseX.set(e.clientX)} onMouseLeave={() => mouseX.set(Infinity)}
          initial={mo.off ? false : { y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={mo.spring(140, 18)}
          style={{ gap: GAP, borderRadius: dock.barRadius, ["--tip-delay" as string]: `${dock.tipDelay}ms`, ...panelStyle(dock.bg) }}
          className="glass flex items-end px-3 pb-1.5 pt-3">
          <Reorder.Group as="div" axis="x" values={pins} onReorder={setPins} className="flex items-end" style={{ gap: GAP }}>
            <AnimatePresence initial={false}>
              {pins.map((p) => {
                const e = byPin.get(p.id)!;
                return (
                  <Reorder.Item key={p.id} as="div" value={p} drag={dock.reorder ? "x" : false} dragElastic={0.1} whileDrag={{ scale: 1.05, zIndex: 20 }}
                    onDragStart={() => { dragging.current = true; setPanel(null); }}
                    onDragEnd={() => setTimeout(() => { dragging.current = false; }, 60)}
                    initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.4, width: 0 }} transition={mo.spring(300, 26)}>
                    <DockIcon {...sz} item={e} mouseX={mouseX} showTip={showTip} bouncing={bounce(e)}
                      onClick={() => activate(e)} onMenu={(x) => setPanel({ kind: "menu", id: e.id, x })} />
                  </Reorder.Item>
                );
              })}
            </AnimatePresence>
          </Reorder.Group>

          <AnimatePresence initial={false}>
            {extras.map((e) => (
              <motion.div key={e.id} initial={{ opacity: 0, scale: 0.4, width: 0 }} animate={{ opacity: 1, scale: 1, width: "auto" }}
                exit={{ opacity: 0, scale: 0.4, width: 0 }} transition={mo.spring(300, 26)}>
                <DockIcon {...sz} item={e} mouseX={mouseX} showTip={showTip}
                  onClick={() => activate(e)} onMenu={(x) => setPanel({ kind: "menu", id: e.id, x })} />
              </motion.div>
            ))}
          </AnimatePresence>

          {dock.separator && <span className="mb-2.5 h-10 w-px self-end" style={{ background: "var(--stroke)" }} aria-hidden />}
          {dock.search && <DockIcon {...sz} item={lens} mouseX={mouseX} showTip={showTip} onClick={() => activate(lens)} />}
          {dock.settings && <DockIcon {...sz} item={cog} mouseX={mouseX} showTip={showTip} onClick={() => activate(cog)} />}
          {dock.downloads && <DockIcon {...sz} item={stack} mouseX={mouseX} showTip={showTip} keep onClick={(ev) => openStack(ev.clientX)} />}
          {dock.trash && <DockIcon {...sz} item={trash} mouseX={mouseX} showTip={showTip} onClick={() => activate(trash)} />}
        </motion.nav>
      </div>
    </div>
  );
}
