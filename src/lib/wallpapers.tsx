import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ImageOff } from "lucide-react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { call, inTauri } from "./tauri";
import { configuredLinks, linkId, linkUrl } from "./wallpaper-links";
import { hexToHsl, hexToRgb, hsl, rng } from "./color";
import { getSettings, updateSettings, useSettings, type MediaKind, type Settings, type WpTransition } from "./settings";
import { usePerf } from "./theme";

// ───────────── Catalogue ─────────────
export interface WallpaperDef { id: string; name: string; tone: "dark" | "light"; group: "sober" | "art" }

/** Fonds intégrés sobres (affichés par défaut) */
export const SOBER_WALLPAPERS: WallpaperDef[] = [
  { id: "graphite", name: "Graphite", tone: "dark", group: "sober" },
  { id: "midnight", name: "Minuit", tone: "dark", group: "sober" },
  { id: "slate", name: "Ardoise", tone: "dark", group: "sober" },
  { id: "aurora", name: "Aurore", tone: "dark", group: "sober" },
  { id: "accent", name: "Couleur d'accent", tone: "dark", group: "sober" },
  { id: "stars", name: "Constellations", tone: "dark", group: "sober" },
  { id: "paper", name: "Papier", tone: "light", group: "sober" },
  { id: "sand", name: "Sable", tone: "light", group: "sober" },
  { id: "solid", name: "Couleur unie", tone: "dark", group: "sober" },
];

/** Fonds illustrés (rangés dans une section repliée des Réglages) */
export const ART_WALLPAPERS: WallpaperDef[] = [
  { id: "sakura", name: "Cerisiers", tone: "dark", group: "art" },
  { id: "dusk", name: "Crépuscule", tone: "dark", group: "art" },
  { id: "neon", name: "Néon", tone: "dark", group: "art" },
  { id: "ocean", name: "Nuit océane", tone: "dark", group: "art" },
  { id: "forest", name: "Brume", tone: "dark", group: "art" },
  { id: "dunes", name: "Dunes", tone: "light", group: "art" },
];

export const BUILTIN_WALLPAPERS: WallpaperDef[] = [...SOBER_WALLPAPERS, ...ART_WALLPAPERS];

/** Le texte posé directement sur le fond (grande horloge) doit être clair ou sombre selon le fond */
export function wallpaperTone(s: Pick<Settings, "wallpaper" | "customWallpapers" | "linkWallpapers">): "dark" | "light" {
  const id = s.wallpaper.id;
  if (id.startsWith("img:") || id.startsWith("vid:") || id.startsWith("aud:")) return s.customWallpapers.find((c) => c.id === id)?.tone ?? "dark";
  if (id.startsWith("link:")) {
    const url = linkUrl(id);
    return s.linkWallpapers.find((l) => l.url === url)?.tone ?? configuredLinks().find((l) => l.url === url)?.tone ?? "dark";
  }
  if (id === "solid") { const [r, g, b] = hexToRgb(s.wallpaper.color); return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "light" : "dark"; }
  return BUILTIN_WALLPAPERS.find((w) => w.id === id)?.tone ?? "dark";
}

// ───────────── Images importées ─────────────
const imgCache = new Map<string, string>();

export function cacheCustomImage(id: string, dataUrl: string) { imgCache.set(id, dataUrl); }

export function useCustomImage(id: string): string | null {
  const [src, setSrc] = useState<string | null>(imgCache.get(id) ?? null);
  useEffect(() => {
    if (!id.startsWith("img:")) return;
    const hit = imgCache.get(id);
    if (hit) { setSrc(hit); return; }
    let alive = true;
    call<string>("read_wallpaper", { name: id.slice(4) }).then((d) => {
      if (!alive || !d) return;
      imgCache.set(id, d); setSrc(d);
    });
    return () => { alive = false; };
  }, [id]);
  return src;
}

/** Réduit l'image à 2560 px max, la convertit en JPEG et estime si elle est claire ou sombre */
export async function importImage(file: File): Promise<{ dataUrl: string; tone: "dark" | "light" }> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  cv.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  const s = document.createElement("canvas");
  s.width = s.height = 16;
  const sg = s.getContext("2d")!;
  sg.drawImage(cv, 0, 0, 16, 16);
  const d = sg.getImageData(0, 0, 16, 16).data;
  let lum = 0;
  for (let i = 0; i < d.length; i += 4) lum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  lum /= (d.length / 4) * 255;
  bmp.close?.();
  return { dataUrl: cv.toDataURL("image/jpeg", 0.88), tone: lum > 0.58 ? "light" : "dark" };
}

/** Vérifie qu'un lien est bien une image ; devine clair/sombre quand le site le permet (sinon tone = undefined) */
export function probeImage(url: string): Promise<{ ok: boolean; tone?: "dark" | "light" }> {
  const load = (cors: boolean) => new Promise<HTMLImageElement | null>((res) => {
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    if (cors) img.crossOrigin = "anonymous";
    const t = window.setTimeout(() => res(null), 20000);
    img.onload = () => { clearTimeout(t); res(img); };
    img.onerror = () => { clearTimeout(t); res(null); };
    img.src = url;
  });
  return load(true).then(async (img) => {
    if (img) {
      try {
        const cv = document.createElement("canvas"); cv.width = cv.height = 16;
        const g = cv.getContext("2d")!; g.drawImage(img, 0, 0, 16, 16);
        const d = g.getImageData(0, 0, 16, 16).data;
        let lum = 0;
        for (let i = 0; i < d.length; i += 4) lum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        return { ok: true, tone: (lum / (d.length / 4) / 255 > 0.58 ? "light" : "dark") as "dark" | "light" };
      } catch { return { ok: true }; }
    }
    // Le site n'autorise pas la lecture des pixels : on vérifie au moins que l'image s'affiche
    return { ok: !!(await load(false)) };
  });
}

// ───────────── Fonds vidéo (mp4…) et audio (mp3…) ─────────────
// Identifiants : "vid:<nom>" (vidéo) et "aud:<nom>" (son) ; le fichier est copié dans <config>/wallpapers/<nom>.<ext>
const VIDEO_EXTS = ["mp4", "m4v", "webm"];
const AUDIO_EXTS = ["mp3", "m4a", "ogg", "wav"];
const AUDIO_MIME: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", wav: "audio/wav" };
export const MEDIA_ACCEPT = "image/*,.mp4,.m4v,.webm,.mp3,.m4a,.ogg,.wav";

export const fileExt = (name: string) => (name.split(".").pop() ?? "").toLowerCase();

export function fileKind(f: File): MediaKind | null {
  const e = fileExt(f.name);
  if (VIDEO_EXTS.includes(e)) return "video";
  if (AUDIO_EXTS.includes(e)) return "audio";
  return f.type.startsWith("image/") ? "image" : null;
}

export function mediaKindOfId(id: string): MediaKind | null {
  if (id.startsWith("vid:")) return "video";
  if (id.startsWith("aud:")) return "audio";
  return id.startsWith("img:") ? "image" : null;
}

/** Seule la fenêtre du bureau de l'écran principal joue du son : sinon il serait répété une fois par écran, et dans les Réglages */
const PARAMS = new URLSearchParams(location.search);
const IS_PRIMARY_DESKTOP = (PARAMS.get("w") ?? "desktop") === "desktop" && !PARAMS.has("m");

/** Copie un fichier vidéo / audio dans le dossier de Halo, par morceaux de 4 Mo (même pour un gros fichier) */
export async function importMedia(file: File, name: string, onProgress?: (p: number) => void): Promise<void> {
  if (!inTauri || !file.size) throw new Error("import impossible");
  const ext = fileExt(file.name);
  const CHUNK = 4 * 1024 * 1024;
  try {
    for (let off = 0; off < file.size; off += CHUNK) {
      const buf = new Uint8Array(await file.slice(off, off + CHUNK).arrayBuffer());
      await invoke("media_chunk", buf, { headers: { "x-name": name, "x-ext": ext, "x-first": off === 0 ? "1" : "0" } });
      onProgress?.(Math.min(1, (off + CHUNK) / file.size));
    }
  } catch (e) {
    await call("delete_wallpaper", { name });
    throw e;
  }
}

/** Adresse lisible par le lecteur vidéo (protocole « asset » de Tauri : lecture en continu, sans tout charger en mémoire) */
function useVideoSrc(id: string): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    let alive = true;
    call<string>("media_path", { name: id.slice(4) }).then((p) => { if (alive && p) setSrc(convertFileSrc(p)); });
    return () => { alive = false; };
  }, [id]);
  return src;
}

/** Fichier audio chargé en mémoire (adresse « blob », même origine que la page : le son peut être analysé pour le visualiseur) */
function useAudioSrc(id: string, enabled: boolean): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!enabled || !inTauri) return;
    let alive = true;
    let url: string | null = null;
    (async () => {
      const path = await invoke<string | null>("media_path", { name: id.slice(4) });
      const buf = await invoke<ArrayBuffer>("read_media", { name: id.slice(4) });
      if (!alive) return;
      url = URL.createObjectURL(new Blob([buf], { type: AUDIO_MIME[fileExt(path ?? "")] ?? "audio/mpeg" }));
      setSrc(url);
    })().catch(() => {});
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [id, enabled]);
  return src;
}

function MediaFailed({ text }: { text: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-white/70" style={{ background: "#0b0c0d" }}>
      <ImageOff size={18} /><span className="px-2 text-center text-[10px]">{text}</span>
    </div>
  );
}

function VideoWallpaper({ id, animated, sound, volume, preview }: { id: string; animated: boolean; sound: boolean; volume: number; preview?: boolean }) {
  const src = useVideoSrc(id);
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const wantSound = sound && !preview && IS_PRIMARY_DESKTOP;
  useEffect(() => { setFailed(false); }, [id]);

  useEffect(() => { if (ref.current) ref.current.volume = volume; }, [volume, src]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !src) return;
    el.loop = true;
    el.muted = !wantSound;
    if (!animated) { el.pause(); return; }
    let off = () => {};
    el.play().catch(() => {
      // Le son est refusé tant qu'il n'y a pas eu de clic : on démarre sans le son, puis on le remet au premier clic sur le bureau
      el.muted = true;
      el.play().catch(() => {});
      if (wantSound) {
        const h = () => { el.muted = false; el.play().catch(() => {}); };
        window.addEventListener("pointerdown", h, { once: true });
        off = () => window.removeEventListener("pointerdown", h);
      }
    });
    return () => { off(); el.pause(); };
  }, [src, animated, wantSound]);

  if (failed) return <MediaFailed text="Vidéo illisible" />;
  return (
    <div className="absolute inset-0" style={{ background: "#0b0c0d" }}>
      {src && (
        <video ref={ref} src={animated ? src : src + "#t=0.5"} playsInline preload={animated && !preview ? "auto" : "metadata"}
          disablePictureInPicture draggable={false} onError={() => setFailed(true)}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
      )}
    </div>
  );
}

function AudioWallpaper({ id, accent, animated, volume, preview, fps = 30 }: { id: string; accent: string; animated: boolean; volume: number; preview?: boolean; fps?: number }) {
  const live = !preview && IS_PRIMARY_DESKTOP;
  const src = useAudioSrc(id, live);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const volRef = useRef(volume);

  useEffect(() => { volRef.current = volume; if (audioRef.current) audioRef.current.volume = volume; }, [volume]);

  // Lecture en boucle ; l'analyseur n'est branché que si le navigateur autorise le son (sinon le morceau serait muet)
  useEffect(() => {
    if (!src) return;
    const a = new Audio(src);
    a.loop = true;
    a.volume = volRef.current;
    audioRef.current = a;
    let ctx: AudioContext | null = null;
    let dead = false;
    const gestures: (() => void)[] = [];
    const onNextClick = (fn: () => void) => { gestures.push(fn); window.addEventListener("pointerdown", fn, { once: true }); };

    const hook = async () => {
      if (ctx || dead) return;
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const c = new Ctor();
      try { await c.resume(); } catch { /* ignoré */ }
      if (dead || c.state !== "running") { c.close().catch(() => {}); if (!dead) onNextClick(() => { hook().catch(() => {}); }); return; }
      const an = c.createAnalyser();
      an.fftSize = 256;
      an.smoothingTimeConstant = 0.8;
      c.createMediaElementSource(a).connect(an);
      an.connect(c.destination);
      ctx = c; analyser.current = an;
    };
    const start = () => {
      a.play().then(() => { hook().catch(() => {}); }, () => onNextClick(start));
    };
    start();

    return () => {
      dead = true;
      gestures.forEach((fn) => window.removeEventListener("pointerdown", fn));
      a.pause(); a.removeAttribute("src"); a.load();
      audioRef.current = null; analyser.current = null;
      ctx?.close().catch(() => {});
    };
  }, [src]);

  // Visualiseur : barres symétriques (graves au centre) + halo qui pulse avec les basses
  const cv = useCanvas((g, w, h) => {
    const [hue] = hexToHsl(accent);
    const N = 64;
    const vals = new Float32Array(N / 2).fill(0.1);
    const data = new Uint8Array(128);
    let raf = 0, last = 0;
    const minDt = 1000 / fps - 2;
    const frame = (now: number) => {
      if (animated && now - last < minDt) { raf = requestAnimationFrame(frame); return; }
      // Lissage indépendant de la cadence : même fluidité à 15, 30 ou 60 images/s
      const k = 1 - Math.exp(-Math.min(0.1, (now - last) / 1000) * 18);
      last = now;
      const t = now / 1000;
      const an = analyser.current;
      if (an) an.getByteFrequencyData(data);
      for (let i = 0; i < vals.length; i++) {
        const k = 1 + Math.floor(Math.pow(i / vals.length, 1.5) * 90);
        const target = an ? data[k] / 255 : 0.1 + 0.07 * Math.sin(t * 1.4 + i * 0.5) + 0.04 * Math.sin(t * 2.3 + i * 0.9);
        vals[i] += (target - vals[i]) * k;
      }
      const bass = (vals[0] + vals[1] + vals[2] + vals[3]) / 4;
      const bg = g.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, hsl(hue, 35, 6)); bg.addColorStop(1, hsl(hue, 45, 3));
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      const R = Math.max(w, h) * (0.3 + bass * 0.3);
      const glow = g.createRadialGradient(w / 2, h * 0.7, 0, w / 2, h * 0.7, R);
      glow.addColorStop(0, hsl(hue, 80, 50, 0.1 + bass * 0.35)); glow.addColorStop(1, hsl(hue, 80, 50, 0));
      g.fillStyle = glow; g.fillRect(0, 0, w, h);
      const span = w * 0.72, bw = span / N, x0 = (w - span) / 2, base = h * 0.74;
      for (let i = 0; i < N; i++) {
        const v = vals[Math.min(vals.length - 1, Math.floor(Math.abs(i - N / 2 + 0.5)))];
        const bh = 4 + v * h * 0.42;
        g.fillStyle = hsl(hue, 85, 62, 0.9);
        g.fillRect(x0 + i * bw + bw * 0.18, base - bh, bw * 0.64, bh);
        g.fillStyle = hsl(hue, 85, 62, 0.18);
        g.fillRect(x0 + i * bw + bw * 0.18, base + 3, bw * 0.64, bh * 0.45);
      }
      if (animated) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [accent, animated, fps]);

  return <canvas ref={cv} className="absolute inset-0 h-full w-full" />;
}

// ───────────── Aides de dessin ─────────────
function useCanvas(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void | (() => void), deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!, parent = cv.parentElement!;
    let cleanup: (() => void) | undefined;
    const run = () => {
      cleanup?.();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.max(1, parent.clientWidth), h = Math.max(1, parent.clientHeight);
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      const g = cv.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      cleanup = draw(g, w, h) || undefined;
    };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(parent);
    return () => { ro.disconnect(); cleanup?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

/** Crête de montagne / dune : somme de sinus déterministe */
function ridge(seed: number, base: number, amp: number, freq: number, W = 1600, H = 1000): string {
  const r = rng(seed);
  const ph = [r() * 6.28, r() * 6.28, r() * 6.28];
  let d = `M0,${H} L0,${base}`;
  for (let x = 0; x <= W; x += 16) {
    const t = x / W;
    const y = base + amp * (Math.sin(t * freq * 6.28 + ph[0]) * 0.6 + Math.sin(t * freq * 13.1 + ph[1]) * 0.3 + Math.sin(t * freq * 27 + ph[2]) * 0.1);
    d += ` L${x},${y.toFixed(1)}`;
  }
  return d + ` L${W},${H} Z`;
}

function Svg({ children }: { children: React.ReactNode }) {
  return <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">{children}</svg>;
}

// ───────────── Fonds ─────────────
function Sakura({ seed }: { seed: number }) {
  const ref = useCanvas((g, w, h) => {
    const r = rng(seed), k = Math.sqrt((w * h) / (1920 * 1080));
    const bg = g.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, "#22282a"); bg.addColorStop(1, "#0b0c0d");
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(8,9,10,.85)"; g.lineCap = "round";
    for (let i = 0; i < 7; i++) {
      g.lineWidth = (3 + r() * 9) * k; g.beginPath();
      g.moveTo(w * r(), h + 20);
      g.bezierCurveTo(w * r(), h * 0.6, w * r(), h * 0.4, w * r(), h * 0.1);
      g.stroke();
    }
    const n = Math.max(50, Math.round(160 * k * k));
    for (let i = 0; i < n; i++) {
      const x = r() * w, y = r() * h, rad = (6 + r() * 26) * k;
      g.filter = `blur(${r() < 0.4 ? 8 * k : k}px)`;
      g.fillStyle = `rgba(222,214,212,${0.12 + r() * 0.55})`;
      g.beginPath(); g.ellipse(x, y, rad, rad * 0.8, r() * 3, 0, 7); g.fill();
    }
    g.filter = "none";
  }, [seed]);
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" />;
}

function Stars({ seed, animated, fps = 30 }: { seed: number; animated: boolean; fps?: number }) {
  const ref = useCanvas((g, w, h) => {
    const r = rng(seed);
    const n = Math.round(Math.min(320, (w * h) / 5500));
    const st = Array.from({ length: n }, () => ({ x: r() * w, y: r() * h, r: 0.4 + r() * 1.5, p: r() * 6.28, sp: 0.5 + r() * 1.8, a: 0.35 + r() * 0.65 }));
    const lines: [number, number][] = [];
    const reach = Math.min(w, h) * 0.11;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (st[i].r > 1.1 && st[j].r > 1.1 && Math.hypot(st[i].x - st[j].x, st[i].y - st[j].y) < reach) lines.push([i, j]);
    }
    const paint = (t: number) => {
      g.clearRect(0, 0, w, h);
      const bg = g.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#04050d"); bg.addColorStop(0.6, "#0b1030"); bg.addColorStop(1, "#1a1740");
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      const glow = g.createRadialGradient(w * 0.7, h * 0.85, 0, w * 0.7, h * 0.85, w * 0.5);
      glow.addColorStop(0, "rgba(120,90,220,.22)"); glow.addColorStop(1, "rgba(120,90,220,0)");
      g.fillStyle = glow; g.fillRect(0, 0, w, h);
      g.strokeStyle = "rgba(170,190,255,.13)"; g.lineWidth = 0.7;
      g.beginPath();
      for (const [i, j] of lines) { g.moveTo(st[i].x, st[i].y); g.lineTo(st[j].x, st[j].y); }
      g.stroke();
      for (const s of st) {
        const tw = animated ? 0.65 + 0.35 * Math.sin(t * s.sp + s.p) : 1;
        g.fillStyle = `rgba(225,232,255,${s.a * tw})`;
        g.beginPath(); g.arc(s.x, s.y, s.r, 0, 6.283); g.fill();
      }
    };
    paint(0);
    if (!animated) return;
    let raf = 0, last = 0;
    const minDt = 1000 / fps - 2;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < minDt || document.hidden) return;
      last = now; paint(now / 1000);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [seed, animated, fps]);
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" />;
}

function Blobs({ base, colors, animated }: { base: string; colors: string[]; animated: boolean }) {
  const pos = [
    { l: "-12%", t: "-35%", s: "75%", k: "a" }, { l: "42%", t: "-45%", s: "80%", k: "b" },
    { l: "8%", t: "20%", s: "85%", k: "c" }, { l: "52%", t: "15%", s: "65%", k: "d" },
  ];
  return (
    <div className={`absolute inset-0 overflow-hidden ${animated ? "halo-anim" : ""}`} style={{ background: base }}>
      {pos.map((p, i) => (
        <div key={i} className={`halo-blob ${p.k}`}
          style={{ left: p.l, top: p.t, width: p.s, aspectRatio: "1 / 1", background: `radial-gradient(circle at center, ${colors[i % colors.length]} 0%, transparent 62%)` }} />
      ))}
      <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, transparent 50%, rgba(0,0,0,.45))" }} />
    </div>
  );
}

function Dusk({ seed }: { seed: number }) {
  const r = rng(seed);
  const stars = Array.from({ length: 70 }, () => ({ x: r() * 1600, y: r() * 430, r: 0.6 + r() * 1.4, o: 0.3 + r() * 0.6 }));
  return (
    <Svg>
      <defs>
        <linearGradient id="d-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#120d36" /><stop offset=".42" stopColor="#47277a" />
          <stop offset=".66" stopColor="#c2487c" /><stop offset=".84" stopColor="#ff8a5c" /><stop offset="1" stopColor="#ffc47c" />
        </linearGradient>
        <radialGradient id="d-glow"><stop offset="0" stopColor="#ffd9a0" stopOpacity=".9" /><stop offset="1" stopColor="#ffd9a0" stopOpacity="0" /></radialGradient>
      </defs>
      <rect width="1600" height="1000" fill="url(#d-sky)" />
      {stars.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" opacity={s.o} />)}
      <circle cx="800" cy="650" r="380" fill="url(#d-glow)" />
      <circle cx="800" cy="650" r="120" fill="#ffe7bd" />
      <path d={ridge(seed + 1, 690, 40, 1.2)} fill="#7d3478" opacity=".92" />
      <path d={ridge(seed + 2, 760, 55, 1.6)} fill="#43205f" />
      <path d={ridge(seed + 3, 850, 50, 1.1)} fill="#220f3d" />
      <path d={ridge(seed + 4, 930, 30, 2)} fill="#0e0620" />
    </Svg>
  );
}

function Dunes({ seed }: { seed: number }) {
  return (
    <Svg>
      <defs>
        <linearGradient id="u-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f7d9b0" /><stop offset=".6" stopColor="#f6b887" /><stop offset="1" stopColor="#ec946a" />
        </linearGradient>
        <radialGradient id="u-glow"><stop offset="0" stopColor="#fff6dc" stopOpacity=".95" /><stop offset="1" stopColor="#fff6dc" stopOpacity="0" /></radialGradient>
      </defs>
      <rect width="1600" height="1000" fill="url(#u-sky)" />
      <circle cx="1180" cy="330" r="300" fill="url(#u-glow)" />
      <circle cx="1180" cy="330" r="82" fill="#fffaf0" />
      <path d={ridge(seed + 1, 640, 50, 0.9)} fill="#e5a070" />
      <path d={ridge(seed + 2, 720, 70, 0.8)} fill="#cf8456" />
      <path d={ridge(seed + 3, 810, 60, 1.1)} fill="#a9603d" />
      <path d={ridge(seed + 4, 900, 45, 0.9)} fill="#6e3a29" />
    </Svg>
  );
}

function Forest({ seed }: { seed: number }) {
  const layers = [
    { b: 560, a: 70, f: 1.1, c: "#7fa89d" }, { b: 640, a: 80, f: 1.4, c: "#5b8680" },
    { b: 720, a: 70, f: 1.0, c: "#3f6862" }, { b: 800, a: 60, f: 1.7, c: "#274a47" }, { b: 890, a: 45, f: 2.1, c: "#112624" },
  ];
  return (
    <Svg>
      <defs>
        <linearGradient id="f-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#14282b" /><stop offset=".5" stopColor="#4d7f79" /><stop offset="1" stopColor="#c6ddd0" />
        </linearGradient>
        <linearGradient id="f-fog" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d4e6dc" stopOpacity="0" /><stop offset="1" stopColor="#d4e6dc" stopOpacity=".34" />
        </linearGradient>
      </defs>
      <rect width="1600" height="1000" fill="url(#f-sky)" />
      {layers.map((l, i) => (
        <g key={i}>
          <path d={ridge(seed + i * 3, l.b, l.a, l.f)} fill={l.c} />
          <rect x="0" y={l.b - 30} width="1600" height={150} fill="url(#f-fog)" />
        </g>
      ))}
    </Svg>
  );
}

function Ocean({ seed }: { seed: number }) {
  const waves = Array.from({ length: 16 }, (_, i) => {
    const y0 = 585 + i * 27, amp = 2 + i * 0.7, wl = 120 + i * 22, ph = i * 1.7 + seed;
    let d = `M0,${y0}`;
    for (let x = 0; x <= 1600; x += 20) d += ` L${x},${(y0 + Math.sin(x / wl + ph) * amp).toFixed(1)}`;
    return { d, o: 0.05 + i * 0.012, w: 1 + i * 0.14 };
  });
  return (
    <Svg>
      <defs>
        <linearGradient id="o-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#030816" /><stop offset=".55" stopColor="#0c2748" /><stop offset="1" stopColor="#1b5b7e" />
        </linearGradient>
        <linearGradient id="o-sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0f4565" /><stop offset="1" stopColor="#030d1c" /></linearGradient>
        <radialGradient id="o-moon"><stop offset="0" stopColor="#f4f1de" stopOpacity=".55" /><stop offset="1" stopColor="#f4f1de" stopOpacity="0" /></radialGradient>
      </defs>
      <rect width="1600" height="580" fill="url(#o-sky)" />
      <rect y="580" width="1600" height="420" fill="url(#o-sea)" />
      <circle cx="1150" cy="230" r="230" fill="url(#o-moon)" />
      <circle cx="1150" cy="230" r="64" fill="#f6f3e2" />
      {Array.from({ length: 12 }, (_, i) => (
        <rect key={i} x={1150 - (95 - i * 6)} y={592 + i * 30} width={(95 - i * 6) * 2} height={3.5} rx="2" fill="#f6f3e2" opacity={0.5 - i * 0.035} />
      ))}
      {waves.map((w, i) => <path key={i} d={w.d} fill="none" stroke="#a7d4f0" strokeOpacity={w.o} strokeWidth={w.w} />)}
    </Svg>
  );
}

function Neon() {
  const hLines = Array.from({ length: 14 }, (_, i) => 600 + 400 * Math.pow(i / 13, 2.1));
  const vLines = Array.from({ length: 41 }, (_, k) => 800 + (k - 20) * 150);
  const mt = "M0,600 L90,520 L170,570 L260,470 L350,560 L430,500 L520,590 L560,600 Z";
  return (
    <Svg>
      <defs>
        <linearGradient id="n-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#09011c" /><stop offset=".5" stopColor="#2b0b52" /><stop offset=".82" stopColor="#8a1d8f" /><stop offset="1" stopColor="#ff3d8b" />
        </linearGradient>
        <linearGradient id="n-sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffe45c" /><stop offset=".55" stopColor="#ff7a45" /><stop offset="1" stopColor="#ff2a8a" /></linearGradient>
        <mask id="n-mask">
          <rect x="560" y="300" width="480" height="300" fill="#fff" />
          {[0, 1, 2, 3, 4, 5].map((i) => <rect key={i} x="560" y={440 + i * 26} width="480" height={3 + i * 2.6} fill="#000" />)}
        </mask>
        <filter id="n-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3" /></filter>
      </defs>
      <rect width="1600" height="1000" fill="url(#n-sky)" />
      <circle cx="800" cy="450" r="210" fill="#ff3d8b" opacity=".22" />
      <circle cx="800" cy="450" r="150" fill="url(#n-sun)" mask="url(#n-mask)" />
      <path d={mt} fill="#12012a" stroke="#ff4fd8" strokeWidth="2" opacity=".95" />
      <path d={mt} transform="translate(1600,0) scale(-1,1)" fill="#12012a" stroke="#ff4fd8" strokeWidth="2" opacity=".95" />
      <rect y="600" width="1600" height="400" fill="#0a011a" />
      <g filter="url(#n-glow)" stroke="#ff4fd8" strokeOpacity=".7" fill="none">
        {hLines.map((y, i) => <line key={"h" + i} x1="0" x2="1600" y1={y} y2={y} strokeWidth={1 + i * 0.12} />)}
        {vLines.map((x, i) => <line key={"v" + i} x1="800" y1="600" x2={x} y2="1000" strokeWidth="1.4" />)}
      </g>
      <g stroke="#ff9be9" strokeOpacity=".9" fill="none">
        {hLines.map((y, i) => <line key={"h" + i} x1="0" x2="1600" y1={y} y2={y} strokeWidth={0.5 + i * 0.05} />)}
        {vLines.map((x, i) => <line key={"v" + i} x1="800" y1="600" x2={x} y2="1000" strokeWidth="0.7" />)}
      </g>
    </Svg>
  );
}

// ───────────── Fond « lien » : image distante ─────────────
function LinkImage({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [url]);
  if (failed) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-white/70" style={{ background: "#0b0c0d" }}>
        <ImageOff size={18} /><span className="px-2 text-center text-[10px]">Image introuvable</span>
      </div>
    );
  }
  return <img src={url} alt="" draggable={false} referrerPolicy="no-referrer" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />;
}

// ───────────── Rendu principal ─────────────
export interface ArtProps {
  id: string; accent: string; color: string; seed: number; animated: boolean;
  /** Son de la vidéo (fonds vidéo) et volume 0–1 (vidéo / mp3) */
  sound?: boolean; volume?: number;
  /** Vignette ou aperçu des Réglages : jamais de son */
  preview?: boolean;
  /** Cadence maximale des animations dessinées (15, 30 ou 60 images/s) */
  fps?: number;
}

export function WallpaperArt({ id, accent, color, seed, animated, sound, volume, preview, fps = 30 }: ArtProps) {
  const custom = useCustomImage(id);
  const [fileOk, setFileOk] = useState(true);
  const h = useMemo(() => hexToHsl(accent)[0], [accent]);

  if (id.startsWith("link:")) return <LinkImage url={linkUrl(id)} />;
  if (id.startsWith("vid:")) return <VideoWallpaper id={id} animated={animated} sound={!!sound} volume={volume ?? 0.5} preview={preview} />;
  if (id.startsWith("aud:")) return <AudioWallpaper id={id} accent={accent} animated={animated} volume={volume ?? 0.5} preview={preview} fps={fps} />;
  if (id.startsWith("img:")) {
    return custom
      ? <img src={custom} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
      : <div className="absolute inset-0" style={{ background: "#0b0c0d" }} />;
  }
  switch (id) {
    case "sakura": return <Sakura seed={seed} />;
    case "stars": return <Stars seed={seed} animated={animated} fps={fps} />;
    case "aurora": return <Blobs animated={animated} base="#040813" colors={["#18e0a0", "#2f7bff", "#8b5cf6", "#06b6d4"]} />;
    case "accent":
      return <Blobs animated={animated} base={hsl(h, 45, 7)}
        colors={[hsl(h, 85, 55), hsl(h + 40, 80, 50), hsl(h - 45, 75, 42), hsl(h + 170, 60, 38)]} />;
    case "dusk": return <Dusk seed={seed} />;
    case "dunes": return <Dunes seed={seed} />;
    case "forest": return <Forest seed={seed} />;
    case "ocean": return <Ocean seed={seed} />;
    case "neon": return <Neon />;
    case "graphite":
      return <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 20% 10%, #3a4146 0%, transparent 55%), linear-gradient(135deg,#2a2f33,#121416 60%,#08090a)" }} />;
    case "midnight":
      return <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 75% 0%, #1d2a4a 0%, transparent 60%), linear-gradient(160deg,#0d1424,#0a0f1c 55%,#04060b)" }} />;
    case "slate":
      return <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 15% 0%, #56606c 0%, transparent 55%), linear-gradient(135deg,#3a434e,#242a32 60%,#161a1f)" }} />;
    case "sand":
      return <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 80% 0%, #faf6ee 0%, transparent 60%), linear-gradient(135deg,#ece5d8,#d3c9b7)" }} />;
    case "paper":
      return <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 80% 0%, #ffffff 0%, transparent 60%), linear-gradient(135deg,#f5f2ec,#d9d3c8)" }} />;
    case "solid": return <div className="absolute inset-0" style={{ background: color }} />;
    case "file":
      return fileOk
        ? <img src="/wallpaper.jpg" alt="" draggable={false} onError={() => setFileOk(false)} className="absolute inset-0 h-full w-full object-cover" />
        : <div className="absolute inset-0" style={{ background: "#0b0c0d" }} />;
    default: return <div className="absolute inset-0" style={{ background: "#0b0c0d" }} />;
  }
}

/** Joue l'effet de révélation du nouveau fond (Web Animations ; les « points » passent par un masque animé image par image).
 *  Renvoie une fonction qui interrompt l'effet et nettoie le style. */
function runReveal(el: HTMLElement, effect: Exclude<WpTransition, "none">, ms: number, done: () => void): () => void {
  if (effect !== "dots") {
    const frames: Keyframe[] = effect === "fade" ? [{ opacity: 0 }, { opacity: 1 }]
      : effect === "circle" ? [{ clipPath: "circle(0% at 50% 50%)" }, { clipPath: "circle(75% at 50% 50%)" }]
      : [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }];
    const a = el.animate(frames, { duration: ms, easing: "cubic-bezier(.4,0,.2,1)", fill: "backwards" });
    a.onfinish = done;
    return () => { a.onfinish = null; a.cancel(); };
  }
  const cell = 44, rMax = cell * 0.76;
  let raf = 0, stopped = false;
  const t0 = performance.now();
  const clear = () => ["mask-image", "-webkit-mask-image", "mask-size", "-webkit-mask-size"].forEach((k) => el.style.removeProperty(k));
  const paint = (r: number) => {
    const v = `radial-gradient(circle at 50% 50%, #000 ${r}px, transparent ${r + 0.8}px)`;
    for (const k of ["mask-image", "-webkit-mask-image"]) el.style.setProperty(k, v);
    for (const k of ["mask-size", "-webkit-mask-size"]) el.style.setProperty(k, `${cell}px ${cell}px`);
  };
  paint(0);
  const tick = (now: number) => {
    if (stopped) return;
    const t = Math.min(1, (now - t0) / ms);
    if (t >= 1) { clear(); done(); return; }
    paint(rMax * (1 - Math.pow(1 - t, 3)));
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => { stopped = true; cancelAnimationFrame(raf); clear(); };
}

/** Fond complet du bureau : image + flou + saturation + assombrissement + vignette.
 *  Lit lui-même ses réglages : un changement de dock ou de barre ne le redessine pas. */
export function Wallpaper() {
  const w = useSettings((s) => s.wallpaper);
  const accent = useSettings((s) => s.accent);
  const m = useSettings((s) => s.motion);
  const perf = usePerf();
  // Les animations lourdes suivent le niveau d'animation et le mode de performance
  const animated = w.animated && m.level === "full";
  const filters = [w.blur ? `blur(${w.blur}px)` : "", w.saturate !== 1 ? `saturate(${w.saturate})` : ""].filter(Boolean).join(" ");
  const fps = perf === "economy" ? Math.min(w.fps, 15) : w.fps;

  // Changement de fond : l'ancien reste dessous, le nouveau est révélé par l'effet choisi (Cercle, Balayage, Points, Fondu)
  const effect: WpTransition = m.fade && m.level !== "off" ? w.transition : "none";
  const k = m.level === "reduced" ? Math.max(m.speed, 1.4) : m.speed;
  const layer = useRef<HTMLDivElement>(null);
  const lastId = useRef(w.id);
  const [prevId, setPrevId] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (lastId.current === w.id) return;
    const old = lastId.current;
    lastId.current = w.id;
    const el = layer.current;
    if (effect === "none" || !el || typeof el.animate !== "function") { setPrevId(null); return; }
    setPrevId(old);
    return runReveal(el, effect, 750 / k, () => setPrevId(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.id]);

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: "#0b0c0d", contain: "strict", ["--wp-speed" as string]: w.speed }}>
      <div className="absolute inset-0" style={filters ? { filter: filters, transform: w.blur ? "scale(1.06)" : undefined } : undefined}>
        {prevId && (
          <div key={"prev:" + prevId} className="absolute inset-0">
            <WallpaperArt id={prevId} accent={accent} color={w.color} seed={w.seed} animated={false} fps={fps} />
          </div>
        )}
        {/* key = id : le nouveau fond est un nouveau calque, révélé par l'effet */}
        <div key={w.id} ref={layer} className="absolute inset-0">
          <WallpaperArt id={w.id} accent={accent} color={w.color} seed={w.seed} animated={animated} sound={w.sound} volume={w.volume} fps={fps} />
        </div>
      </div>
      <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${w.dim})` }} />
      {w.vignette > 0 && <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,${w.vignette}) 100%)` }} />}
    </div>
  );
}

/** Tous les fonds proposés, dans l'ordre du carrousel des Réglages (ma collection, sobres, illustrations) */
export function allWallpaperIds(s: Pick<Settings, "linkWallpapers" | "customWallpapers">): string[] {
  return [...new Set([
    ...configuredLinks().map((l) => linkId(l.url)), ...s.linkWallpapers.map((l) => linkId(l.url)), ...s.customWallpapers.map((c) => c.id),
    ...BUILTIN_WALLPAPERS.map((b) => b.id),
  ])];
}

/** Fond d'écran suivant (1) ou précédent (-1) : raccourcis clavier */
export function cycleWallpaper(dir: 1 | -1) {
  const s = getSettings();
  const ids = allWallpaperIds(s);
  if (!ids.length) return;
  const i = ids.indexOf(s.wallpaper.id);
  const id = ids[i < 0 ? 0 : (i + dir + ids.length) % ids.length];
  updateSettings((x) => ({ ...x, wallpaper: { ...x.wallpaper, id } }));
}

/** Vérifie si public/wallpaper.jpg existe (ancien mode de fond d'écran) */
export function useFileWallpaperExists(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const i = new Image();
    i.onload = () => setOk(true);
    i.src = "/wallpaper.jpg";
  }, []);
  return ok;
}
