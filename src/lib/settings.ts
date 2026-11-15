import { useSyncExternalStore } from "react";
import { call, on, send } from "./tauri";

// ───────────── Types ─────────────
export type ThemeMode = "dark" | "light" | "auto";
export type MotionLevel = "full" | "reduced" | "off";
export type PerfMode = "quality" | "balanced" | "economy";
/** Économie d'énergie automatique : jamais · sur batterie · batterie faible (≤ 20 %) */
export type AutoEco = "off" | "battery" | "low";
export type DockSpring = "soft" | "normal" | "snappy";
export type DateStyle = "short" | "long" | "numeric" | "none";
export type WidgetType = "clock" | "calendar" | "system" | "sound" | "spotify" | "spotify-embed" | "notes";
/** Fond d'une barre : verre, opaque ou transparent */
export type PanelBg = "glass" | "solid" | "none";
export type IndicatorStyle = "dot" | "bar" | "glow";
export type FontChoice = "inter" | "system" | "serif" | "mono";
export type SearchEngine = "google" | "duckduckgo" | "bing" | "brave" | "qwant" | "ecosia" | "startpage" | "custom";

export interface Pin { id: string; label: string; exe: string[]; target: string; iconKey?: string; img?: string }

export type MediaKind = "image" | "video" | "audio";
/** Effet joué quand on change de fond d'écran */
export type WpTransition = "circle" | "wipe" | "dots" | "fade" | "none";
export const WP_TRANSITIONS: WpTransition[] = ["circle", "wipe", "dots", "fade", "none"];
export interface CustomWallpaper { id: string; name: string; tone: "dark" | "light" }
/** Fond d'écran ajouté par lien depuis les Réglages (ceux du fichier wallpaper-links.ts n'y sont pas stockés) */
export interface LinkWallpaper { url: string; name: string; tone: "dark" | "light" }

export interface WidgetInstance {
  id: string;
  type: WidgetType;
  /** Ancrage horizontal : l = bord gauche, c = centre, r = bord droit */
  ax: "l" | "c" | "r";
  /** Ancrage vertical : t = haut, b = bas */
  ay: "t" | "b";
  /** Décalage (px) depuis l'ancre */
  x: number;
  y: number;
  scale: number;
  visible: boolean;
  opts: Record<string, unknown>;
}

/** Barre du haut : éléments affichés, aspect et comportements */
export interface TopBarCfg {
  bg: PanelBg; size: number; gap: number; label: boolean;
  search: boolean; background: boolean; network: boolean; volume: boolean; battery: boolean; batteryPercent: boolean;
  control: boolean; clock: boolean; power: boolean;
  wheelVolume: boolean; confirmPower: boolean;
  /** Tuiles du centre de contrôle */
  ccVolume: boolean; ccBrightness: boolean; ccMedia: boolean; ccTheme: boolean; ccTaskbar: boolean; ccSettings: boolean; ccQuit: boolean;
}

/** Recherche d'applications (Alt + Espace) */
export interface SearchCfg {
  engine: SearchEngine; custom: string;
  web: boolean; urls: boolean; halo: boolean; calc: boolean; system: boolean;
  recents: number; max: number; remember: boolean;
}

/** Raccourcis clavier globaux (accélérateur Tauri, ex. « Alt+Space » ; vide = désactivé) */
export interface ShortcutsCfg {
  search: string; settings: string; widgets: string; nextWallpaper: string; prevWallpaper: string; theme: string; mute: string;
}

export interface Settings {
  v: 1;
  rev: number;
  theme: ThemeMode;
  accent: string;
  glass: number;      // opacité du verre 0.15 – 0.9
  blur: number;       // flou du verre en px
  radius: number;     // arrondi des cartes en px
  font: FontChoice;
  /** Accessibilité */
  a11y: { contrast: boolean; solid: boolean };
  /** Sortie audio dont le volume est piloté : "" = sortie par défaut de Windows, "@auto" = Wave Link, ou un morceau du nom d'une sortie */
  audio: { device: string };
  clock: { hour12: boolean; seconds: boolean; date: boolean; dateStyle: DateStyle; weekday: boolean; locale: string };
  /** Aspect du verre (détails) */
  glassFx: { saturate: number; border: number; shadow: number };
  /** Fluidité : niveau d'animation, vitesse, performances, fréquences d'actualisation */
  motion: { level: MotionLevel; speed: number; perf: PerfMode; fade: boolean; autoEco: AutoEco };
  refresh: { apps: number; status: number };   // secondes
  hideTaskbar: boolean;
  autoHideFullscreen: boolean;   // barre du haut + dock masqués quand une application est en plein écran
  autoHideMaximized: boolean;    // ... et aussi quand une fenêtre est simplement agrandie (rappel par le bord de l'écran)
  wallpaper: {
    id: string; dim: number; blur: number; animated: boolean; color: string; seed: number; sound: boolean; volume: number;
    saturate: number; vignette: number; speed: number; fps: number; transition: WpTransition;
  };
  customWallpapers: CustomWallpaper[];
  linkWallpapers: LinkWallpaper[];
  topbar: TopBarCfg;
  dock: {
    size: number; magnify: boolean; zoom: number; labels: boolean; indicators: boolean;
    search: boolean; settings: boolean; downloads: boolean; trash: boolean;
    gap: number; range: number; spring: DockSpring; bounce: boolean; tipDelay: number; iconRadius: number; barRadius: number;
    showRunning: boolean; separator: boolean; indicator: IndicatorStyle; bg: PanelBg; dlCount: number; reorder: boolean;
  };
  search: SearchCfg;
  shortcuts: ShortcutsCfg;
  /** Bureau : réglages communs à tous les widgets */
  desktop: { widgets: boolean; allScreens: boolean; snap: number; opacity: number; menu: boolean };
  pins: Pin[];
  widgets: WidgetInstance[];
}

// ───────────── Valeurs par défaut ─────────────
export const DEFAULT_PINS: Pin[] = [
  { id: "files", label: "Explorateur", exe: ["explorer"], target: "explorer", iconKey: "files" },
  { id: "edge", label: "Edge", exe: ["msedge"], target: "msedge", iconKey: "edge" },
  { id: "spotify", label: "Spotify", exe: ["spotify"], target: "spotify:", iconKey: "music" },
  { id: "term", label: "Terminal", exe: ["windowsterminal"], target: "wt", iconKey: "term" },
  { id: "calc", label: "Calculatrice", exe: ["calculatorapp", "calculator"], target: "calc", iconKey: "calc" },
  { id: "settings", label: "Réglages Windows", exe: ["systemsettings"], target: "ms-settings:", iconKey: "settings" },
];

export const ACCENTS = ["#e5484d", "#f76b15", "#f5b400", "#30a46c", "#1db954", "#12a594", "#0091ff", "#6e56cf", "#d6409f", "#8d8d8d"];

export const SEARCH_ENGINES: Record<Exclude<SearchEngine, "custom">, { name: string; url: string }> = {
  google: { name: "Google", url: "https://www.google.com/search?q=" },
  duckduckgo: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q=" },
  bing: { name: "Bing", url: "https://www.bing.com/search?q=" },
  brave: { name: "Brave Search", url: "https://search.brave.com/search?q=" },
  qwant: { name: "Qwant", url: "https://www.qwant.com/?q=" },
  ecosia: { name: "Ecosia", url: "https://www.ecosia.org/search?q=" },
  startpage: { name: "Startpage", url: "https://www.startpage.com/do/search?q=" },
};

/** Adresse de recherche web pour un texte (moteur choisi ; moteur perso : « %s » est remplacé, sinon le texte est ajouté à la fin) */
export function webSearchUrl(c: SearchCfg, q: string): string {
  const e = encodeURIComponent(q);
  if (c.engine === "custom" && /^https?:\/\/\S+$/i.test(c.custom.trim())) {
    const u = c.custom.trim();
    return u.includes("%s") ? u.replace(/%s/g, e) : u + e;
  }
  const k = c.engine === "custom" ? "google" : c.engine;
  return SEARCH_ENGINES[k].url + e;
}

export function newId(prefix = "w"): string {
  return prefix + Math.random().toString(36).slice(2, 8);
}

export const DEFAULT_WIDGETS: WidgetInstance[] = [
  { id: "w-clock", type: "clock", ax: "c", ay: "t", x: 0, y: 130, scale: 1, visible: true, opts: { style: "big" } },
  { id: "w-cal", type: "calendar", ax: "l", ay: "t", x: 24, y: 56, scale: 1, visible: true, opts: {} },
  { id: "w-sys", type: "system", ax: "l", ay: "t", x: 24, y: 322, scale: 1, visible: true, opts: {} },
  { id: "w-sound", type: "sound", ax: "r", ay: "t", x: 24, y: 56, scale: 1, visible: true, opts: { style: "disc" } },
  { id: "w-spotify", type: "spotify", ax: "c", ay: "t", x: 0, y: 40, scale: 1, visible: true, opts: { style: "island" } },
];

export const DEFAULTS: Settings = {
  v: 1,
  rev: 0,
  theme: "dark",
  accent: "#e5484d",
  glass: 0.52,
  blur: 28,
  radius: 18,
  font: "inter",
  a11y: { contrast: false, solid: false },
  audio: { device: "@auto" },
  clock: { hour12: false, seconds: false, date: true, dateStyle: "short", weekday: true, locale: "fr-FR" },
  glassFx: { saturate: 140, border: 1, shadow: 1 },
  motion: { level: "full", speed: 1, perf: "balanced", fade: true, autoEco: "off" },
  refresh: { apps: 2.5, status: 15 },
  hideTaskbar: true,
  autoHideFullscreen: true,
  autoHideMaximized: true,
  wallpaper: { id: "graphite", dim: 0.28, blur: 0, animated: true, color: "#1b1d20", seed: 7, sound: false, volume: 0.5, saturate: 1, vignette: 0, speed: 1, fps: 30, transition: "fade" },
  customWallpapers: [],
  linkWallpapers: [],
  topbar: {
    bg: "glass", size: 13, gap: 14, label: true,
    search: true, background: true, network: true, volume: true, battery: true, batteryPercent: true, control: true, clock: true, power: true,
    wheelVolume: true, confirmPower: true,
    ccVolume: true, ccBrightness: true, ccMedia: true, ccTheme: true, ccTaskbar: true, ccSettings: true, ccQuit: true,
  },
  dock: { size: 52, magnify: true, zoom: 1.6, labels: true, indicators: true, search: true, settings: true, downloads: true, trash: true,
          gap: 10, range: 150, spring: "normal", bounce: true, tipDelay: 0, iconRadius: 22, barRadius: 26,
          showRunning: true, separator: true, indicator: "dot", bg: "glass", dlCount: 12, reorder: true },
  search: { engine: "google", custom: "", web: true, urls: true, halo: true, calc: true, system: true, recents: 8, max: 10, remember: true },
  shortcuts: { search: "Alt+Space", settings: "", widgets: "", nextWallpaper: "", prevWallpaper: "", theme: "", mute: "@auto" },
  desktop: { widgets: true, allScreens: false, snap: 0, opacity: 1, menu: true },
  pins: DEFAULT_PINS,
  widgets: DEFAULT_WIDGETS,
};

// ───────────── Normalisation (anciennes versions, champs manquants) ─────────────
const num = (v: unknown, d: number, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const str = (v: unknown, d: string) => (typeof v === "string" && v ? v : d);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
/** Copie les booléens connus de `src` (valeur par défaut si absents ou invalides) */
function bools<T extends object>(src: Record<string, unknown>, d: T): { [K in keyof T as T[K] extends boolean ? K : never]: boolean } {
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(d)) if (typeof v === "boolean") out[k] = bool(src[k], v);
  return out as never;
}
/** Raccourci valide (« Ctrl+Alt+K ») ou vide (désactivé) */
const accel = (v: unknown, d: string) => (typeof v !== "string" ? d : v === "" ? "" : /^([A-Za-z]+\+)*[A-Za-z0-9]+$/.test(v) ? v : d);

function legacyPins(): Pin[] | null {
  try { const s = localStorage.getItem("halo.pins"); if (s) { const p = JSON.parse(s); if (Array.isArray(p)) return p; } } catch { /* ignore */ }
  return null;
}

const WIDGET_TYPES: WidgetType[] = ["clock", "calendar", "system", "sound", "spotify", "spotify-embed", "notes"];

function normWidget(raw: unknown): WidgetInstance | null {
  const w = obj(raw);
  const type = w.type as WidgetType;
  if (!WIDGET_TYPES.includes(type)) return null;
  // Ancien widget Spotify par défaut (carte en bas à droite, jamais modifiée) → nouvelle île en haut au centre
  const o = obj(w.opts);
  if (type === "spotify" && w.id === "w-spotify" && w.ax === "r" && w.ay === "b" && w.x === 24 && w.y === 130 && Object.keys(o).length === 1 && o.style === "card") {
    return { id: "w-spotify", type, ax: "c", ay: "t", x: 0, y: 40, scale: num(w.scale, 1, 0.5, 2.5), visible: bool(w.visible, true), opts: { style: "island" } };
  }
  return {
    id: str(w.id, newId()), type,
    ax: w.ax === "c" || w.ax === "r" ? w.ax : "l",
    ay: w.ay === "b" ? "b" : "t",
    x: num(w.x, 24, -4000, 4000), y: num(w.y, 56, -4000, 4000),
    scale: num(w.scale, 1, 0.5, 2.5), visible: bool(w.visible, true), opts: obj(w.opts),
  };
}

export function normalize(raw: unknown): Settings {
  const r = obj(raw), d = DEFAULTS;
  const dock = obj(r.dock), wp = obj(r.wallpaper), clock = obj(r.clock);
  const fx = obj(r.glassFx), mo = obj(r.motion), rf = obj(r.refresh);
  const tb = obj(r.topbar), se = obj(r.search), sc = obj(r.shortcuts), de = obj(r.desktop), ac = obj(r.a11y), au = obj(r.audio);
  const pins = Array.isArray(r.pins) ? (r.pins as Pin[]).filter((p) => p && typeof p.id === "string") : legacyPins() ?? d.pins;
  const widgets = Array.isArray(r.widgets)
    ? r.widgets.map(normWidget).filter((w): w is WidgetInstance => !!w)
    : d.widgets;
  return {
    v: 1,
    rev: num(r.rev, 0, 0, Number.MAX_SAFE_INTEGER),
    theme: r.theme === "light" || r.theme === "auto" ? r.theme : "dark",
    accent: str(r.accent, d.accent),
    glass: num(r.glass, d.glass, 0.1, 0.95),
    blur: num(r.blur, d.blur, 0, 60),
    radius: num(r.radius, d.radius, 4, 36),
    font: oneOf(r.font, ["inter", "system", "serif", "mono"] as const, d.font),
    a11y: { contrast: bool(ac.contrast, false), solid: bool(ac.solid, false) },
    audio: { device: typeof au.device === "string" ? au.device.replace(/[\u0000-\u001f|]/g, "").trim().slice(0, 120) : d.audio.device },
    clock: {
      hour12: bool(clock.hour12, d.clock.hour12), seconds: bool(clock.seconds, d.clock.seconds), date: bool(clock.date, d.clock.date),
      dateStyle: clock.dateStyle === "long" || clock.dateStyle === "numeric" || clock.dateStyle === "none" ? clock.dateStyle : "short",
      weekday: bool(clock.weekday, d.clock.weekday),
      locale: typeof clock.locale === "string" && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$|^$/.test(clock.locale) ? clock.locale : d.clock.locale,
    },
    glassFx: { saturate: num(fx.saturate, d.glassFx.saturate, 100, 220), border: num(fx.border, d.glassFx.border, 0, 2.5), shadow: num(fx.shadow, d.glassFx.shadow, 0, 2) },
    motion: {
      level: mo.level === "reduced" || mo.level === "off" ? mo.level : "full",
      speed: num(mo.speed, d.motion.speed, 0.5, 2),
      perf: mo.perf === "quality" || mo.perf === "economy" ? mo.perf : "balanced",
      fade: bool(mo.fade, d.motion.fade),
      autoEco: oneOf(mo.autoEco, ["off", "battery", "low"] as const, d.motion.autoEco),
    },
    refresh: { apps: num(rf.apps, d.refresh.apps, 1, 15), status: num(rf.status, d.refresh.status, 5, 120) },
    hideTaskbar: bool(r.hideTaskbar, d.hideTaskbar),
    autoHideFullscreen: bool(r.autoHideFullscreen, d.autoHideFullscreen),
    autoHideMaximized: bool(r.autoHideMaximized, d.autoHideMaximized),
    wallpaper: {
      id: str(wp.id, d.wallpaper.id), dim: num(wp.dim, d.wallpaper.dim, 0, 0.85), blur: num(wp.blur, 0, 0, 24),
      animated: bool(wp.animated, true), color: str(wp.color, d.wallpaper.color), seed: num(wp.seed, d.wallpaper.seed, 1, 99999),
      sound: bool(wp.sound, false), volume: num(wp.volume, 0.5, 0, 1),
      saturate: num(wp.saturate, 1, 0, 2), vignette: num(wp.vignette, 0, 0, 0.9), speed: num(wp.speed, 1, 0.25, 3),
      fps: wp.fps === 60 || wp.fps === 15 ? wp.fps : 30,
      transition: WP_TRANSITIONS.includes(wp.transition as WpTransition) ? (wp.transition as WpTransition) : "fade",
    },
    customWallpapers: Array.isArray(r.customWallpapers)
      ? (r.customWallpapers as CustomWallpaper[]).filter((c) => c && typeof c.id === "string").map((c) => ({ id: c.id, name: str(c.name, "Image"), tone: c.tone === "light" ? "light" : "dark" }))
      : [],
    linkWallpapers: Array.isArray(r.linkWallpapers)
      ? (r.linkWallpapers as LinkWallpaper[])
          .filter((c) => c && typeof c.url === "string" && /^https?:\/\/\S+$/i.test(c.url))
          .map((c) => ({ url: c.url, name: str(c.name, "Lien"), tone: (c.tone === "light" ? "light" : "dark") as "dark" | "light" }))
      : [],
    topbar: {
      ...bools(tb, d.topbar),
      bg: oneOf(tb.bg, ["glass", "solid", "none"] as const, d.topbar.bg),
      size: num(tb.size, d.topbar.size, 11, 16), gap: num(tb.gap, d.topbar.gap, 4, 32),
    } as TopBarCfg,
    dock: {
      size: num(dock.size, d.dock.size, 32, 80), magnify: bool(dock.magnify, true), zoom: num(dock.zoom, d.dock.zoom, 1, 2.2),
      labels: bool(dock.labels, true), indicators: bool(dock.indicators, true),
      gap: num(dock.gap, d.dock.gap, 2, 28), range: num(dock.range, d.dock.range, 60, 300),
      spring: dock.spring === "soft" || dock.spring === "snappy" ? dock.spring : "normal",
      bounce: bool(dock.bounce, true), tipDelay: num(dock.tipDelay, 0, 0, 1500),
      iconRadius: num(dock.iconRadius, d.dock.iconRadius, 8, 50), barRadius: num(dock.barRadius, d.dock.barRadius, 6, 40),
      search: bool(dock.search, true), settings: bool(dock.settings, true), downloads: bool(dock.downloads, true), trash: bool(dock.trash, true),
      showRunning: bool(dock.showRunning, d.dock.showRunning), separator: bool(dock.separator, d.dock.separator),
      indicator: oneOf(dock.indicator, ["dot", "bar", "glow"] as const, d.dock.indicator),
      bg: oneOf(dock.bg, ["glass", "solid", "none"] as const, d.dock.bg),
      dlCount: Math.round(num(dock.dlCount, d.dock.dlCount, 3, 12)), reorder: bool(dock.reorder, d.dock.reorder),
    },
    search: {
      ...bools(se, d.search),
      engine: oneOf(se.engine, ["google", "duckduckgo", "bing", "brave", "qwant", "ecosia", "startpage", "custom"] as const, d.search.engine),
      custom: typeof se.custom === "string" ? se.custom.slice(0, 300) : "",
      recents: Math.round(num(se.recents, d.search.recents, 0, 12)), max: Math.round(num(se.max, d.search.max, 4, 16)),
    } as SearchCfg,
    shortcuts: {
      search: accel(sc.search, d.shortcuts.search), settings: accel(sc.settings, d.shortcuts.settings), widgets: accel(sc.widgets, d.shortcuts.widgets),
      nextWallpaper: accel(sc.nextWallpaper, d.shortcuts.nextWallpaper), prevWallpaper: accel(sc.prevWallpaper, d.shortcuts.prevWallpaper),
      theme: accel(sc.theme, d.shortcuts.theme), mute: accel(sc.mute, d.shortcuts.mute),
    },
    desktop: {
      widgets: bool(de.widgets, d.desktop.widgets), allScreens: bool(de.allScreens, d.desktop.allScreens), menu: bool(de.menu, d.desktop.menu),
      snap: oneOf(String(de.snap), ["0", "8", "16", "24", "32", "48"] as const, "0") === "0" ? 0 : Number(de.snap),
      opacity: num(de.opacity, d.desktop.opacity, 0.2, 1),
    },
    pins, widgets,
  };
}

// ───────────── Store partagé entre les fenêtres ─────────────
const KEY = "halo.settings.v1";
const EVENT = "halo-settings";

function readLocal(): Settings | null {
  try { const raw = localStorage.getItem(KEY); return raw ? normalize(JSON.parse(raw)) : null; } catch { return null; }
}

let state: Settings = readLocal() ?? normalize({});
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

export const getSettings = () => state;

/** Tous les réglages (le composant se met à jour à chaque changement) ou, avec un sélecteur, seulement la partie utile :
 *  `useSettings((s) => s.dock)` ne relance le composant que si le dock change. Le sélecteur doit renvoyer une valeur stable
 *  (un objet du magasin, un nombre, un booléen…), jamais un nouvel objet créé à chaque appel. */
export function useSettings(): Settings;
export function useSettings<T>(select: (s: Settings) => T): T;
export function useSettings<T>(select?: (s: Settings) => T): Settings | T {
  return useSyncExternalStore(subscribe, select ? () => select(state) : () => state);
}

let flushT = 0, fileT = 0;
let lastPins: Pin[] | null = null;
function schedule() {
  if (!flushT) {
    flushT = window.setTimeout(() => {
      flushT = 0;
      // Les icônes d'applications (images en base64) pèsent lourd : on ne les rediffuse que si les épingles ont changé
      const light = state.pins === lastPins;
      lastPins = state.pins;
      send(EVENT, light ? { ...state, pins: state.pins.map((p) => (p.img ? { ...p, img: "@" } : p)) } : state);
    }, 80);
  }
  // Écriture sur disque (et cache local) regroupée : un curseur qu'on fait glisser ne réécrit pas le fichier à chaque image
  clearTimeout(fileT);
  fileT = window.setTimeout(() => {
    const json = JSON.stringify(state);
    try { localStorage.setItem(KEY, json); } catch { /* ignore */ }
    call("save_settings", { json });
  }, 500);
}

export function updateSettings(fn: (s: Settings) => Settings) {
  const next = fn(state);
  state = { ...next, rev: Math.max(Date.now(), state.rev + 1) };
  notify();
  schedule();
}

export function updateWidget(id: string, fn: (w: WidgetInstance) => WidgetInstance) {
  updateSettings((s) => ({ ...s, widgets: s.widgets.map((w) => (w.id === id ? fn(w) : w)) }));
}

/** Garde l'ancienne référence de chaque partie inchangée : les composants qui n'écoutent que cette partie ne se redessinent pas */
function share(prev: Settings, next: Settings): { merged: Settings; changed: boolean } {
  const out = { ...next } as Record<string, unknown>;
  let changed = false;
  for (const k of Object.keys(next) as (keyof Settings)[]) {
    if (k === "rev") continue;
    const a = prev[k], b = next[k];
    if (a === b || (typeof a === "object" && typeof b === "object" && JSON.stringify(a) === JSON.stringify(b))) out[k] = a;
    else changed = true;
  }
  return { merged: out as unknown as Settings, changed };
}

function adopt(next: Settings) {
  // Version plus ancienne, ou identique (écho de notre propre diffusion) : rien à faire
  if (next.rev <= state.rev) return;
  const { merged, changed } = share(state, next);
  state = merged;
  if (changed) notify();
}

/** Remet les icônes des épingles (envoyées sous forme allégée « @ ») à partir de celles déjà connues */
function fromWire(p: unknown): unknown {
  const r = obj(p);
  if (!Array.isArray(r.pins)) return p;
  return { ...r, pins: (r.pins as Pin[]).map((x) => (x && x.img === "@" ? { ...x, img: state.pins.find((o) => o.id === x.id)?.img } : x)) };
}

/** À appeler une fois au démarrage de chaque fenêtre */
export function initSettings() {
  addEventListener("storage", (e) => {
    if (e.key === KEY && e.newValue) { try { adopt(normalize(JSON.parse(e.newValue))); } catch { /* ignore */ } }
  });
  on<unknown>(EVENT, (p) => adopt(normalize(fromWire(p))));
  // Le fichier JSON (dossier de configuration de l'app) fait foi si plus récent que le cache local
  call<string>("load_settings").then((j) => {
    if (!j) return;
    try { adopt(normalize(JSON.parse(j))); } catch { /* ignore */ }
  });
}

/** Valeurs d'origine (copie neuve à chaque appel) */
export function freshDefaults(): Settings {
  return { ...normalize({}), pins: DEFAULT_PINS, widgets: DEFAULT_WIDGETS };
}

/** Tout rétablir : les fonds d'écran que tu as importés ou ajoutés par lien restent dans ta liste */
export function resetSettings() {
  updateSettings((s) => ({ ...freshDefaults(), customWallpapers: s.customWallpapers, linkWallpapers: s.linkWallpapers }));
}

/** Rétablit seulement certaines parties des réglages (le reste est conservé) */
export function resetKeys(keys: (keyof Settings)[]) {
  const d = freshDefaults() as unknown as Record<string, unknown>;
  updateSettings((s) => {
    const n = { ...s } as unknown as Record<string, unknown>;
    for (const k of keys) n[k] = d[k];
    return n as unknown as Settings;
  });
}

/** Catégories rétablissables séparément (bouton en haut de chaque page, et Réglages › Système) */
export const RESET_GROUPS: Record<string, { label: string; keys: (keyof Settings)[] }> = {
  wallpaper: { label: "Fond d'écran", keys: ["wallpaper"] },
  appearance: { label: "Apparence", keys: ["theme", "accent", "glass", "blur", "radius", "glassFx", "font", "a11y"] },
  topbar: { label: "Barre du haut", keys: ["topbar", "clock"] },
  dock: { label: "Dock", keys: ["dock"] },
  widgets: { label: "Widgets", keys: ["widgets", "desktop"] },
  search: { label: "Recherche", keys: ["search"] },
  shortcuts: { label: "Raccourcis", keys: ["shortcuts"] },
  motion: { label: "Animations", keys: ["motion", "refresh"] },
};

// ───────────── Sauvegarde / restauration ─────────────
export function exportSettings(): string {
  return JSON.stringify({ halo: "settings", exportedAt: new Date().toISOString(), settings: state }, null, 2);
}

/** Importe un fichier de réglages exporté. Les fonds importés depuis un autre PC (images, vidéos, sons) ne sont pas repris. */
export function importSettings(text: string): { ok: true } | { ok: false; error: string } {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return { ok: false, error: "Ce texte n'est pas un fichier de réglages valide (JSON illisible)." }; }
  const o = obj(j);
  const raw = obj(o.settings).v !== undefined || o.halo === "settings" ? obj(o.settings) : o;
  if (!raw || (raw.v === undefined && raw.theme === undefined && raw.dock === undefined && raw.wallpaper === undefined)) {
    return { ok: false, error: "Aucun réglage de Halo reconnu dans ce fichier." };
  }
  const n = normalize(raw);
  const keepOwn = state.customWallpapers;
  const id = n.wallpaper.id;
  const missing = /^(img|vid|aud):/.test(id) && !keepOwn.some((c) => c.id === id);
  updateSettings(() => ({
    ...n,
    customWallpapers: keepOwn,
    wallpaper: missing ? { ...n.wallpaper, id: "graphite" } : n.wallpaper,
  }));
  return { ok: true };
}
