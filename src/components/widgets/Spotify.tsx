import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ExternalLink, FastForward, Music, Pause, Play, Rewind, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from "lucide-react";
import { call } from "../../lib/tauri";
import { formatTime } from "../../lib/color";
import { DEFAULT_PALETTE, paletteFromPixels, type Palette } from "../../lib/palette";
import { isSpotify, mediaCmd, setVolume, toggleMute, useDaemonAlive, useMedia, useMediaPos, useVolume, type MediaState } from "../../lib/sys";
import { useSettings } from "../../lib/settings";
import { IconBtn, type WProps } from "./common";

const GREEN = "#1db954";

/** Palette (fond, accent, texte) calculée à partir de la pochette ; garde l'ancienne le temps du calcul pour une transition douce */
const palCache = new Map<string, Palette>();
function usePalette(src: string | null): Palette {
  const [pal, setPal] = useState<Palette>(DEFAULT_PALETTE);
  useEffect(() => {
    // Pas de pochette (ou pas encore reçue) : on garde l'ancienne palette 1,5 s avant de revenir au neutre
    if (!src) { const t = window.setTimeout(() => setPal(DEFAULT_PALETTE), 1500); return () => clearTimeout(t); }
    const k = `${src.length}:${src.slice(64, 120)}:${src.slice(-48)}`;
    const hit = palCache.get(k);
    if (hit) { setPal(hit); return; }
    let alive = true;
    const img = new Image();
    img.onload = () => {
      try {
        const N = 40, cv = document.createElement("canvas"); cv.width = cv.height = N;
        const g = cv.getContext("2d", { willReadFrequently: true })!; g.drawImage(img, 0, 0, N, N);
        const p = paletteFromPixels(g.getImageData(0, 0, N, N).data);
        if (palCache.size > 40) palCache.clear();
        palCache.set(k, p);
        if (alive) setPal(p);
      } catch { if (alive) setPal(DEFAULT_PALETTE); }
    };
    img.onerror = () => { if (alive) setPal(DEFAULT_PALETTE); };
    img.src = src;
    return () => { alive = false; };
  }, [src]);
  return pal;
}

function sourceLabel(m: MediaState) {
  if (isSpotify(m.app)) return "Spotify";
  // Windows : "chrome.exe", "Microsoft.ZuneMusic_xxx!App" · Linux (MPRIS) : "vlc", "firefox.instance_1_234"
  const n = m.app.replace(/\.exe$/i, "").split("!")[0].replace(/\.instance.*$/i, "");
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : "Média";
}

function Cover({ src, size, radius = 12 }: { src: string | null; size: number; radius?: number }) {
  return src
    ? <img src={src} alt="" draggable={false} style={{ width: size, height: size, borderRadius: radius }} className="shrink-0 object-cover shadow-lg" />
    : <div style={{ width: size, height: size, borderRadius: radius, background: "rgba(255,255,255,.1)" }} className="flex shrink-0 items-center justify-center"><Music size={size * 0.4} className="opacity-70" /></div>;
}

function Progress({ m, pos, color, onSeek = true, thin = false }: { m: MediaState; pos: number; color: string; onSeek?: boolean; thin?: boolean }) {
  const frac = m.dur > 0 ? Math.min(1, pos / m.dur) : 0;
  return (
    <div
      role="slider" aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(m.dur)} aria-valuenow={Math.round(pos)}
      onClick={onSeek && m.dur > 0 ? (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        mediaCmd("seek", Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * m.dur);
      } : undefined}
      className={`w-full rounded-full ${onSeek ? "cursor-pointer" : ""}`}
      style={{ height: thin ? 3 : 14, display: "flex", alignItems: "center" }}>
      <div className="w-full rounded-full" style={{ height: thin ? 3 : 4, background: "rgba(255,255,255,.25)" }}>
        <div className="h-full rounded-full" style={{ width: `${frac * 100}%`, background: color, transition: "width .5s linear" }} />
      </div>
    </div>
  );
}

function Controls({ m, big = true }: { m: MediaState; big?: boolean }) {
  return (
    <div className="flex items-center justify-center gap-2.5">
      <IconBtn label="Précédent" onClick={() => mediaCmd("prev")}><SkipBack size={big ? 20 : 17} fill="currentColor" /></IconBtn>
      <IconBtn label={m.playing ? "Pause" : "Lecture"} onClick={() => mediaCmd("toggle")} size={big ? 46 : 38} solid>
        {m.playing ? <Pause size={big ? 20 : 17} fill="currentColor" /> : <Play size={big ? 20 : 17} fill="currentColor" className="ml-0.5" />}
      </IconBtn>
      <IconBtn label="Suivant" onClick={() => mediaCmd("next")}><SkipForward size={big ? 20 : 17} fill="currentColor" /></IconBtn>
    </div>
  );
}

function Idle({ compact, m }: { compact?: boolean; m?: MediaState }) {
  // Petit indice de diagnostic : ce que le système voit (ou l'erreur du service)
  const alive = useDaemonAlive();
  const hint = !alive ? "Le service système de Halo ne répond pas" : m?.err ? `Erreur : ${m.err}` : m?.sessions.length ? `Vu par le système : ${m.sessions.map((a) => a.replace(/\.exe$/i, "").split("!")[0]).join(", ")}` : "Lance un titre dans Spotify";
  return (
    <div className={`flex items-center gap-3 ${compact ? "" : "py-2"}`}>
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: "rgba(255,255,255,.1)" }}><Music size={20} /></div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold">Aucune lecture en cours</div>
        <div className="truncate text-[11px] opacity-60" title={hint}>{hint}</div>
      </div>
      <button type="button" onClick={() => call("launch", { target: "spotify:" })} title="Ouvrir Spotify"
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold text-black transition-transform hover:scale-105 active:scale-95"
        style={{ background: GREEN }}>Ouvrir<ExternalLink size={12} /></button>
    </div>
  );
}

const darkScrim = "linear-gradient(180deg, rgba(0,0,0,.08), rgba(0,0,0,.42))";

function Backdrop({ art, blur = true }: { art: string | null; blur?: boolean }) {
  return (
    <>
      <div className="absolute inset-0" style={art && blur
        ? { background: `url(${art}) center/cover`, filter: "blur(34px) saturate(1.5) brightness(.55)", transform: "scale(1.5)" }
        : { background: "linear-gradient(135deg, color-mix(in srgb, var(--accent) 45%, #15171a), #15171a)" }} />
      <div className="absolute inset-0" style={{ background: darkScrim }} />
    </>
  );
}

// ───────────── Carte adaptative : fond, accent et texte suivent la pochette ─────────────
function Equalizer({ playing }: { playing: boolean }) {
  return <span className="np-eq" data-on={playing ? "1" : "0"} aria-hidden="true"><i /><i /><i /><i /></span>;
}

function SeekBar({ m, pos }: { m: MediaState; pos: number }) {
  const frac = m.dur > 0 ? Math.min(1, pos / m.dur) : 0;
  return (
    <div
      role="slider" aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(m.dur)} aria-valuenow={Math.round(pos)}
      className="np-bar"
      onClick={m.dur > 0 ? (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        mediaCmd("seek", Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * m.dur);
      } : undefined}>
      <div className="np-bar-track"><div className="np-bar-fill" style={{ width: `${frac * 100}%` }} /></div>
    </div>
  );
}

function AdaptiveCard({ m, pos, pal, controls, progress }: { m: MediaState; pos: number; pal: Palette; controls: boolean; progress: boolean }) {
  // Les couleurs passent par des variables CSS enregistrées (@property) : elles s'animent d'un morceau à l'autre
  const vars = { "--pc1": pal.c1, "--pc2": pal.c2, "--pc3": pal.c3, "--pac": pal.accent, "--pfg": pal.accentFg, "--pglow": pal.glow, color: pal.fg } as CSSProperties;
  return (
    <div className="np-card relative w-[340px] overflow-hidden border" style={{ ...vars, borderColor: "rgba(255,255,255,.12)", boxShadow: "var(--shadow)", borderRadius: "var(--radius)" }} aria-label="Lecture en cours">
      {m.art && <div className="np-art-bg" style={{ backgroundImage: `url("${m.art}")` }} />}
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,.04), rgba(0,0,0,.36))" }} />
      <div className="relative p-4">
        {!m.on ? <Idle m={m} /> : (
          <>
            <div className="flex gap-3.5">
              <div key={m.art ?? "none"} className="np-fade shrink-0" style={{ filter: "drop-shadow(0 10px 18px var(--pglow))" }}>
                <Cover src={m.art} size={96} radius={16} />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: pal.fgDim }}>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: m.playing ? "var(--pac)" : pal.fgDim }} />
                    {sourceLabel(m)}{!m.playing && " · pause"}
                  </span>
                  <Equalizer playing={m.playing} />
                </div>
                <div className="line-clamp-2 text-[17px] font-bold leading-tight">{m.title}</div>
                <div className="mt-0.5 truncate text-[13px]" style={{ color: pal.fgDim }}>{m.artist}</div>
                {m.album && <div className="truncate text-[11px]" style={{ color: pal.fgDim, opacity: 0.75 }}>{m.album}</div>}
              </div>
            </div>
            {progress && (
              <div className="mt-3.5">
                <SeekBar m={m} pos={pos} />
                <div className="-mt-0.5 flex justify-between text-[10px] tabular-nums" style={{ color: pal.fgDim }}><span>{formatTime(pos)}</span><span>{formatTime(m.dur)}</span></div>
              </div>
            )}
            {controls && (
              <div className="mt-1.5 flex items-center justify-center gap-4">
                <button type="button" aria-label="Précédent" title="Précédent" onClick={() => mediaCmd("prev")} className="np-ghost"><SkipBack size={20} fill="currentColor" /></button>
                <button type="button" aria-label={m.playing ? "Pause" : "Lecture"} title={m.playing ? "Pause" : "Lecture"} onClick={() => mediaCmd("toggle")} className="np-play">
                  {m.playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" className="ml-0.5" />}
                </button>
                <button type="button" aria-label="Suivant" title="Suivant" onClick={() => mediaCmd("next")} className="np-ghost"><SkipForward size={20} fill="currentColor" /></button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ───────────── Widget « En cours de lecture » (cartes) ─────────────
function NowPlayingWidget({ opts }: WProps) {
  const m = useMedia();
  const pos = useMediaPos(m);
  const style = (opts.style as string) ?? "card";
  const controls = opts.controls !== false, progress = opts.progress !== false;
  const art = m.art;
  const pal = usePalette(art);
  const bar = pal.accent;

  // Par défaut : toute application (Spotify est prioritaire quand il joue) — Spotify Web, YouTube, VLC… s'affichent aussi
  const source = opts.source === "spotify" ? 1 : 0;
  useEffect(() => { mediaCmd("only", source); }, [source]);

  const shell = "relative overflow-hidden border text-white";
  const shellStyle = { borderColor: "var(--stroke)", boxShadow: "var(--shadow)", borderRadius: "var(--radius)" } as const;

  if (style === "minimal") {
    return (
      <div className="group w-[380px]" style={{ color: "var(--clock-color, var(--text))", textShadow: "0 2px 24px rgba(0,0,0,.3)" }}>
        {!m.on ? <div className="text-sm font-medium opacity-70">♪ Aucune lecture en cours</div> : (
          <>
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] opacity-70">
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: m.playing ? GREEN : "currentColor" }} />{sourceLabel(m)}
            </div>
            <div className="line-clamp-2 text-[30px] font-extrabold leading-[1.05] tracking-tight">{m.title}</div>
            <div className="mt-1.5 truncate text-[16px] font-medium opacity-75">{m.artist}</div>
            {progress && <div className="mt-3 text-white"><Progress m={m} pos={pos} color={bar} thin onSeek={false} /></div>}
            {controls && <div className="mt-2 flex justify-start text-white opacity-0 transition-opacity group-hover:opacity-100"><Controls m={m} big={false} /></div>}
          </>
        )}
      </div>
    );
  }

  if (style === "compact") {
    return (
      <div className={`${shell} w-[320px] p-2.5`} style={shellStyle} aria-label="Lecture en cours">
        <Backdrop art={art} />
        <div className="relative">
          {!m.on ? <Idle compact m={m} /> : (
            <div className="flex items-center gap-3">
              <Cover src={art} size={48} radius={10} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">{m.title}</div>
                <div className="truncate text-[12px] opacity-70">{m.artist}</div>
              </div>
              {controls && (
                <div className="flex shrink-0 items-center">
                  <IconBtn label={m.playing ? "Pause" : "Lecture"} onClick={() => mediaCmd("toggle")} size={34}>
                    {m.playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
                  </IconBtn>
                  <IconBtn label="Suivant" onClick={() => mediaCmd("next")} size={34}><SkipForward size={18} fill="currentColor" /></IconBtn>
                </div>
              )}
            </div>
          )}
          {m.on && progress && <div className="mt-2"><Progress m={m} pos={pos} color={bar} thin onSeek={false} /></div>}
        </div>
      </div>
    );
  }

  if (style === "cover") {
    return (
      <div className={`${shell} group w-[250px]`} style={{ ...shellStyle, aspectRatio: "1 / 1" }} aria-label="Lecture en cours">
        {art ? <img src={art} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" /> : <Backdrop art={null} />}
        {!m.on ? <div className="relative flex h-full items-center p-3"><div className="w-full"><Idle m={m} /></div></div> : (
          <>
            <div className="absolute inset-x-0 bottom-0 h-3/5" style={{ background: "linear-gradient(to top, rgba(0,0,0,.82), transparent)" }} />
            <div className="absolute inset-x-0 bottom-0 p-3.5">
              <div className="truncate text-[15px] font-bold">{m.title}</div>
              <div className="truncate text-[12px] opacity-75">{m.artist}</div>
              {controls && <div className="mt-2 h-0 overflow-hidden opacity-0 transition-all group-hover:h-[46px] group-hover:opacity-100"><Controls m={m} big={false} /></div>}
              {progress && <div className="mt-2"><Progress m={m} pos={pos} color={bar} thin onSeek={false} /></div>}
            </div>
          </>
        )}
      </div>
    );
  }

  // card (par défaut) : carte adaptative
  return <AdaptiveCard m={m} pos={pos} pal={pal} controls={controls} progress={progress} />;
}

// ───────────── Style « île » : une pastille qui s'agrandit au clic ─────────────
/** Heure « HH:MM » mise à jour pile à la minute */
function useClockText(hour12: boolean, locale: string): string {
  const [t, setT] = useState("");
  useEffect(() => {
    let id = 0;
    const fmt = () => new Date().toLocaleTimeString(locale || undefined, { hour: "2-digit", minute: "2-digit", hourCycle: hour12 ? "h12" : "h23" });
    const tick = () => { setT(fmt()); id = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50); };
    tick();
    return () => clearTimeout(id);
  }, [hour12, locale]);
  return t;
}

function IslandEq({ on }: { on: boolean }) {
  return <span className="isl-eq" data-on={on ? "1" : "0"} aria-hidden="true"><i /><i /><i /><i /><i /></span>;
}

function IslandIdle({ m }: { m: MediaState }) {
  const alive = useDaemonAlive();
  const hint = !alive ? "Le service système de Halo ne répond pas" : m.err ? `Erreur : ${m.err}` : m.sessions.length ? `Vu par le système : ${m.sessions.map((a) => a.replace(/\.exe$/i, "").split("!")[0]).join(", ")}` : "Lance un titre dans Spotify";
  return (
    <div className="isl-idle">
      <div className="isl-idle-ico"><Music size={22} /></div>
      <div className="isl-idle-txt">
        <div className="isl-title">Aucune lecture en cours</div>
        <div className="isl-artist" title={hint}>{hint}</div>
      </div>
      <button type="button" onClick={() => call("launch", { target: "spotify:" })} title="Ouvrir Spotify" className="isl-open" style={{ background: GREEN }}>
        Ouvrir<ExternalLink size={12} />
      </button>
    </div>
  );
}

function IslandWidget({ opts, edit }: WProps) {
  const m = useMedia();
  const vol = useVolume();
  const hour12 = useSettings((s) => s.clock.hour12);
  const locale = useSettings((s) => s.clock.locale);
  const time = useClockText(hour12, locale);
  const controls = opts.controls !== false, progress = opts.progress !== false;
  const centre = opts.centre === "title" || opts.centre === "elapsed" ? opts.centre : "time";
  const autoClose = opts.autoclose !== false, tint = opts.tint === true;

  const [open, setOpen] = useState(false);
  const [peek, setPeek] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef(0);
  const peekTimer = useRef(0);
  const lastKey = useRef<string | null>(null);
  const isOpen = open && !edit;

  const pos = useMediaPos(m, isOpen || centre === "elapsed" ? 500 : 60_000);
  const pal = usePalette(tint ? m.art : null);
  const ac = tint && m.art ? pal.accent : "#ffffff";

  // Même règle que la carte : toute application média (Spotify prioritaire), ou Spotify seulement
  const source = opts.source === "spotify" ? 1 : 0;
  useEffect(() => { mediaCmd("only", source); }, [source]);

  // Détection d'un nouveau morceau (ou d'une musique qui démarre) : la pastille affiche le titre quelques secondes
  useEffect(() => {
    if (!m.on) { lastKey.current = ""; return; }
    if (lastKey.current !== null && lastKey.current !== m.key && m.title) {
      clearTimeout(peekTimer.current);
      setPeek(true);
      peekTimer.current = window.setTimeout(() => setPeek(false), 4500);
    }
    lastKey.current = m.key;
  }, [m.on, m.key, m.title]);
  useEffect(() => () => { clearTimeout(peekTimer.current); clearTimeout(leaveTimer.current); }, []);

  // Se réduit : clic ailleurs, Échap, autre fenêtre au premier plan, ou souris qui s'éloigne (délai court)
  useEffect(() => {
    if (!isOpen) return;
    const down = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const close = () => setOpen(false);
    addEventListener("mousedown", down);
    addEventListener("keydown", key);
    addEventListener("blur", close);
    return () => { removeEventListener("mousedown", down); removeEventListener("keydown", key); removeEventListener("blur", close); };
  }, [isOpen]);

  const onEnter = () => clearTimeout(leaveTimer.current);
  const onLeave = () => {
    if (!autoClose || !isOpen) return;
    clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => setOpen(false), 650);
  };
  const expand = () => { if (!edit && !open) { setOpen(true); setPeek(false); } };

  const baseText = centre === "title" && m.on ? m.title : centre === "elapsed" && m.on ? formatTime(pos) : time;
  const frac = m.dur > 0 ? Math.min(1, pos / m.dur) : 0;
  const VIcon = vol.mute || vol.vol === 0 ? VolumeX : vol.vol < 0.4 ? Volume1 : Volume2;
  const h = !m.on ? 92 : progress ? 134 : 108;

  return (
    <div ref={root} className="isl" data-open={isOpen ? "1" : "0"} data-on={m.on ? "1" : "0"}
      role={isOpen ? "group" : "button"} tabIndex={isOpen || edit ? -1 : 0} aria-expanded={isOpen}
      aria-label={m.on ? `Lecture en cours : ${m.title}` : "Lecture en cours"}
      style={{ ["--isl-h" as string]: `${h}px`, ["--isl-ac" as string]: ac } as CSSProperties}
      onClick={expand} onKeyDown={(e) => { if (!isOpen && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); expand(); } }}
      onPointerEnter={onEnter} onPointerLeave={onLeave}
      onWheel={isOpen && !edit ? (e) => setVolume(vol.vol + (e.deltaY < 0 ? 0.03 : -0.03)) : undefined}>

      {/* Petite version : égaliseur · heure (ou titre) · pochette */}
      <div className="isl-layer isl-compact" aria-hidden={isOpen}>
        <IslandEq on={m.on && m.playing} />
        <span className="isl-mid" data-peek={peek && m.on && centre !== "title" ? "1" : "0"}>
          <span className="isl-time">{baseText}</span>
          <span className="isl-time isl-peek">{m.title}</span>
        </span>
        {m.on && m.art
          ? <img src={m.art} alt="" draggable={false} className="isl-mini" />
          : <span className="isl-mini isl-mini-ico"><Music size={13} /></span>}
      </div>

      {/* Grande version : lecteur complet */}
      <div className="isl-layer isl-full" aria-hidden={!isOpen}>
        {!m.on ? <IslandIdle m={m} /> : (
          <>
            <div className="isl-top">
              <div key={m.art ?? "none"} className="isl-cover np-fade">
                {m.art ? <img src={m.art} alt="" draggable={false} /> : <Music size={28} />}
              </div>
              <div className="isl-col">
                <div className="isl-head">
                  <div className="isl-text">
                    <div className="isl-title" title={m.title}>{m.title}</div>
                    <div className="isl-artist" title={m.artist}>{m.artist || sourceLabel(m)}</div>
                  </div>
                  <IslandEq on={m.playing} />
                </div>
                {controls && (
                  <div className="isl-ctl">
                    <button type="button" aria-label="Précédent" title="Précédent" onClick={() => mediaCmd("prev")} className="isl-btn"><Rewind size={22} fill="currentColor" /></button>
                    <button type="button" aria-label={m.playing ? "Pause" : "Lecture"} title={m.playing ? "Pause" : "Lecture"} onClick={() => mediaCmd("toggle")} className="isl-btn isl-btn-main">
                      {m.playing ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" className="isl-play-ico" />}
                    </button>
                    <button type="button" aria-label="Suivant" title="Suivant" onClick={() => mediaCmd("next")} className="isl-btn"><FastForward size={22} fill="currentColor" /></button>
                  </div>
                )}
              </div>
            </div>
            {progress && (
              <div className="isl-prog">
                <span className="isl-clock">{formatTime(pos)}</span>
                <div role="slider" aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(m.dur)} aria-valuenow={Math.round(pos)} className="isl-bar"
                  onClick={m.dur > 0 ? (e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    mediaCmd("seek", Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * m.dur);
                  } : undefined}>
                  <div className="isl-track"><div className="isl-fill" style={{ width: `${frac * 100}%` }} /></div>
                </div>
                <button type="button" onClick={toggleMute} className="isl-vol" aria-label="Volume : couper / rétablir"
                  title={`${vol.ok ? `${vol.mute ? 0 : Math.round(vol.vol * 100)} %` : "Volume"} · clic : muet · molette : volume`}>
                  <VIcon size={16} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ───────────── Widget Spotify : île (par défaut) ou cartes ─────────────
export function SpotifyWidget(props: WProps) {
  return (props.opts.style ?? "island") === "island" ? <IslandWidget {...props} /> : <NowPlayingWidget {...props} />;
}

// ───────────── Widget « Lecteur Spotify intégré » (lien à coller) ─────────────
export function parseSpotifyUrl(url: string): { kind: string; id: string } | null {
  const m = url.match(/(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?|spotify:)(track|album|playlist|artist|episode|show)[/:]([A-Za-z0-9]{10,30})/);
  return m ? { kind: m[1], id: m[2] } : null;
}

export function SpotifyEmbedWidget({ opts, edit }: WProps) {
  const url = typeof opts.url === "string" ? opts.url : "";
  const p = parseSpotifyUrl(url);
  const full = opts.size === "full";
  const h = full ? 352 : 152;
  return (
    <div className="relative w-[340px] overflow-hidden" style={{ height: h, borderRadius: "var(--radius)" }} aria-label="Lecteur Spotify">
      {p ? (
        <iframe title="Spotify" loading="lazy" style={{ border: 0, width: "100%", height: h, colorScheme: "normal", pointerEvents: edit ? "none" : "auto" }}
          src={`https://open.spotify.com/embed/${p.kind}/${p.id}?utm_source=generator&theme=0`}
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" />
      ) : (
        <div className="glass flex h-full flex-col items-center justify-center gap-2 p-5 text-center">
          <Music size={26} className="opacity-70" />
          <div className="text-[13px] font-semibold">Lecteur Spotify</div>
          <div className="text-[11px] mono-dim">Colle le lien d'une playlist, d'un album ou d'un titre dans les options du widget (Réglages › Widgets).</div>
        </div>
      )}
    </div>
  );
}
