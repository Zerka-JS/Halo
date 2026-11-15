import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, LayoutGrid, Minus, Move, Palette, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { call, on } from "../lib/tauri";
import { updateSettings, updateWidget, useSettings, type WidgetInstance } from "../lib/settings";
import { Wallpaper, wallpaperTone } from "../lib/wallpapers";
import { resolveOpts, WIDGETS } from "../components/widgets/registry";
import { ErrorBoundary } from "../components/ErrorBoundary";

interface Size { w: number; h: number }
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function place(w: WidgetInstance, W: number, H: number, sz: Size) {
  const left = w.ax === "l" ? w.x : w.ax === "r" ? W - sz.w - w.x : (W - sz.w) / 2 + w.x;
  const top = w.ay === "t" ? w.y : H - sz.h - w.y;
  return { left: clamp(left, 0, Math.max(0, W - sz.w)), top: clamp(top, 0, Math.max(0, H - sz.h)) };
}

const WidgetFrame = memo(function WidgetFrame({ w, W, H, edit, snap, opacity }: { w: WidgetInstance; W: number; H: number; edit: boolean; snap: number; opacity: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [sz, setSz] = useState<Size>({ w: 0, h: 0 });
  const [drag, setDrag] = useState<{ left: number; top: number } | null>(null);
  const start = useRef<{ px: number; py: number; left: number; top: number } | null>(null);
  const meta = WIDGETS[w.type];
  const Comp = meta.Component;

  useLayoutEffect(() => {
    const el = ref.current!;
    const measure = () => { const r = el.getBoundingClientRect(); setSz((p) => (Math.abs(p.w - r.width) < 0.5 && Math.abs(p.h - r.height) < 0.5 ? p : { w: r.width, h: r.height })); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pos = drag ?? place(w, W, H, sz);

  const onDown = (e: React.PointerEvent) => {
    if (!edit || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { px: e.clientX, py: e.clientY, left: pos.left, top: pos.top };
  };
  const onMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    // Grille magnétique (Réglages › Widgets) : la position se cale sur des multiples de `snap` px
    const g = (v: number) => (snap > 0 ? Math.round(v / snap) * snap : v);
    setDrag({ left: clamp(g(s.left + e.clientX - s.px), 0, Math.max(0, W - sz.w)), top: clamp(g(s.top + e.clientY - s.py), 0, Math.max(0, H - sz.h)) });
  };
  const onUp = () => {
    if (!start.current || !drag) { start.current = null; return; }
    start.current = null;
    const cx = drag.left + sz.w / 2, cy = drag.top + sz.h / 2;
    const ax = cx < W / 3 ? "l" : cx > (2 * W) / 3 ? "r" : "c";
    const ay = cy > H * 0.6 ? "b" : "t";
    let x = ax === "l" ? drag.left : ax === "r" ? W - sz.w - drag.left : drag.left - (W - sz.w) / 2;
    if (ax === "c" && Math.abs(x) < 14) x = 0; // aimante au centre
    const y = ay === "t" ? drag.top : H - sz.h - drag.top;
    updateWidget(w.id, (o) => ({ ...o, ax, ay, x: Math.round(x), y: Math.round(y) }));
    setDrag(null);
  };

  const setScale = (d: number) => updateWidget(w.id, (o) => ({ ...o, scale: Math.round(clamp(o.scale + d, 0.5, 2.5) * 20) / 20 }));

  return (
    <div ref={ref} className={`halo-wframe absolute ${edit ? "widget-edit" : ""}`}
      style={{ left: pos.left, top: pos.top, visibility: sz.w ? "visible" : "hidden", zIndex: drag ? 20 : 1, touchAction: "none", opacity: edit ? 1 : opacity }}>
      <div style={{ zoom: w.scale }}><ErrorBoundary mode="widget" name={meta.name}><Comp id={w.id} opts={resolveOpts(w)} edit={edit} /></ErrorBoundary></div>
      {edit && (
        <>
          <div className="absolute inset-0 cursor-move" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
          <div className={`glass glass-strong absolute -top-11 flex items-center gap-0.5 whitespace-nowrap rounded-full px-1.5 py-1 text-[11px] ${w.ax === "l" ? "left-0" : w.ax === "r" ? "right-0" : "left-1/2 -translate-x-1/2"}`}
            onPointerDown={(e) => e.stopPropagation()}>
            <Move size={13} className="mx-1.5 mono-dim" aria-hidden />
            <span className="mr-1 font-medium">{meta.name}</span>
            <button type="button" aria-label="Réduire" onClick={() => setScale(-0.1)} className="rounded-full p-1.5 hover:bg-white/15"><Minus size={13} /></button>
            <span className="w-9 text-center tabular-nums mono-dim">{Math.round(w.scale * 100)}%</span>
            <button type="button" aria-label="Agrandir" onClick={() => setScale(0.1)} className="rounded-full p-1.5 hover:bg-white/15"><Plus size={13} /></button>
            <button type="button" aria-label="Options du widget" onClick={() => call("open_settings", { page: "widgets:" + w.id })} className="rounded-full p-1.5 hover:bg-white/15"><SlidersHorizontal size={13} /></button>
            <button type="button" aria-label="Retirer le widget" onClick={() => updateSettings((s) => ({ ...s, widgets: s.widgets.filter((x) => x.id !== w.id) }))}
              className="rounded-full p-1.5 hover:bg-white/15" style={{ color: "var(--accent)" }}><Trash2 size={13} /></button>
          </div>
        </>
      )}
    </div>
  );
});

// Fenêtre d'un écran secondaire (?m=1, ?m=2…) : même fond d'écran, mais les widgets restent sur l'écran principal
const SECONDARY = new URLSearchParams(location.search).has("m");

export default function Desktop() {
  const widgets = useSettings((s) => s.widgets);
  const dsk = useSettings((s) => s.desktop);
  const wallpaper = useSettings((s) => s.wallpaper);
  const customWallpapers = useSettings((s) => s.customWallpapers);
  const linkWallpapers = useSettings((s) => s.linkWallpapers);
  const [edit, setEdit] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [view, setView] = useState({ w: innerWidth, h: innerHeight });

  useEffect(() => {
    const f = () => setView({ w: innerWidth, h: innerHeight });
    addEventListener("resize", f);
    return () => removeEventListener("resize", f);
  }, []);
  useEffect(() => on<boolean>("halo-edit-widgets", (v) => setEdit(!SECONDARY && !!v)), []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { setEdit(false); setMenu(null); } };
    const d = () => setMenu(null);
    addEventListener("keydown", k);
    addEventListener("mousedown", d);
    return () => { removeEventListener("keydown", k); removeEventListener("mousedown", d); };
  }, []);

  const tone = wallpaperTone({ wallpaper, customWallpapers, linkWallpapers });
  const showWidgets = dsk.widgets && (!SECONDARY || dsk.allScreens);
  const clockColor = tone === "light" ? "#1d1d1f" : "#f6efe0";

  return (
    <main className="relative h-full w-full overflow-hidden" style={{ background: "#0b0c0d", ["--clock-color" as string]: clockColor }}
      onContextMenu={(e) => { e.preventDefault(); if (!dsk.menu) return; setMenu({ x: Math.min(e.clientX, view.w - 230), y: Math.min(e.clientY, view.h - 180) }); }}>
      <Wallpaper />
      {showWidgets && widgets.filter((w) => w.visible).map((w) => <WidgetFrame key={w.id} w={w} W={view.w} H={view.h} edit={edit && !SECONDARY} snap={dsk.snap} opacity={dsk.opacity} />)}

      {edit && (
        <div className="glass glass-strong halo-pop absolute left-1/2 top-12 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full py-1.5 pl-4 pr-1.5 text-[13px]">
          <span className="font-medium">Mode édition · glisse les widgets pour les placer</span>
          <button type="button" onClick={() => call("open_settings", { page: "widgets" })} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold hover:bg-white/10"><LayoutGrid size={14} />Ajouter</button>
          <button type="button" onClick={() => setEdit(false)} className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold"
            style={{ background: "var(--accent)", color: "var(--accent-fg)" }}><Check size={14} />Terminé</button>
        </div>
      )}

      {menu && (
        <div role="menu" className="glass glass-strong halo-pop absolute z-40 w-56 rounded-[var(--radius)] p-1.5" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          {[
            ...(SECONDARY ? [] : [{ icon: <LayoutGrid size={15} />, label: edit ? "Terminer la modification" : "Modifier les widgets", run: () => setEdit((v) => !v) }]),
            { icon: <Palette size={15} />, label: "Changer le fond d'écran…", run: () => call("open_settings", { page: "wallpaper" }) },
            { icon: <SlidersHorizontal size={15} />, label: "Réglages de Halo…", run: () => call("open_settings", { page: "appearance" }) },
          ].map((m) => (
            <button key={m.label} type="button" role="menuitem" onClick={() => { setMenu(null); m.run(); }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-white/10">{m.icon}{m.label}</button>
          ))}
        </div>
      )}
    </main>
  );
}
