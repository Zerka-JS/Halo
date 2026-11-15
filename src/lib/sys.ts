import { useEffect, useState, useSyncExternalStore } from "react";
import { call, on } from "./tauri";
import { useSettings } from "./settings";

// ───────────── Audio réel (démon PowerShell → évènement "halo-audio") ─────────────
// Format : "A|pic|volume|muet|nbSorties|sortieLaPlusForte"   pic = niveau crête 0..1, le plus fort de toutes les sorties actives
export const audioBus = {
  endpoints: 0,   // nombre de sorties audio surveillées (toutes les sorties actives de Windows)
  peak: 0,        // dernier pic reçu
  at: 0,          // horodatage de réception (performance.now)
  agc: 0.12,      // gain automatique : plus grand pic récent
};

export interface VolumeState { vol: number; mute: boolean; ok: boolean }
let volState: VolumeState = { vol: 0.5, mute: false, ok: false };
const volSubs = new Set<() => void>();
const notifyVol = () => volSubs.forEach((f) => f());
let audioStarted = false;
/** Dernier message reçu du démon (audio ou média) : sert à savoir s'il tourne */
let daemonSeenAt = 0;
const bootAt = performance.now();
let ignoreUntil = 0; // laisse la main au curseur pendant qu'on le déplace

function startAudio() {
  if (audioStarted) return;
  audioStarted = true;
  on<string>("halo-audio", (line) => {
    const p = line.split("|");
    if (p[0] === "D") {
      // Liste des sorties audio : "D|choix|sortie pilotée|sortie 1|sortie 2|…"
      devState = p[1] === "!legacy"
        ? { known: false, legacy: p[2] || "erreur inconnue", applied: "", selected: "", names: [], at: performance.now() }
        : { known: true, legacy: null, applied: p[1] ?? "", selected: p[2] ?? "", names: p.slice(3).filter(Boolean), at: performance.now() };
      devSubs.forEach((f) => f());
      return;
    }
    if (p[0] !== "A" || p.length < 4) return;
    const peak = Math.max(0, Math.min(1, parseFloat(p[1]) || 0));
    audioBus.peak = peak; audioBus.at = performance.now(); audioBus.endpoints = parseInt(p[4] ?? "", 10) || 0;
    daemonSeenAt = performance.now();
    const vol = Math.max(0, Math.min(1, parseFloat(p[2]) || 0)), mute = p[3] === "1";
    if (performance.now() < ignoreUntil) return;
    if (!volState.ok || Math.abs(vol - volState.vol) > 0.004 || mute !== volState.mute) {
      volState = { vol, mute, ok: true };
      notifyVol();
    }
  });
}

// ───────────── Sortie audio pilotée (Windows, Elgato Wave Link…) ─────────────
export interface AudioDevices {
  known: boolean;          // le démon a répondu (faux : démon absent ou ancienne version)
  legacy: string | null;   // non nul : le démon tourne en version d'origine (le code du choix de sortie n'a pas compilé) ; contient la cause
  applied: string;         // choix actuellement appliqué par le démon
  selected: string;        // nom de la sortie dont on lit / règle le volume
  names: string[];         // sorties actives
  at: number;
}
let devState: AudioDevices = { known: false, legacy: null, applied: "", selected: "", names: [], at: 0 };
const devSubs = new Set<() => void>();
const subDev = (cb: () => void) => { devSubs.add(cb); return () => { devSubs.delete(cb); }; };
const getDev = () => devState;

/** Sorties audio vues par le démon (demande la liste à l'ouverture) */
export function useAudioDevices(): AudioDevices {
  useEffect(() => { startAudio(); call("audio_device", {}); }, []);
  return useSyncExternalStore(subDev, getDev);
}

/** À utiliser dans UNE fenêtre : applique au démon le choix de Réglages › Système › Sortie du volume */
export function useAudioDeviceSync() {
  const want = useSettings((s) => s.audio.device);
  const d = useAudioDevices();
  useEffect(() => { if (d.known && d.applied !== want) call("audio_device", { name: want }); }, [want, d]);
}

/** Indicateur de son : true = ne mesure que la sortie choisie (casque…), false = toutes les sorties actives */
export function useMeterSync(selectedOnly: boolean) {
  const d = useAudioDevices();
  useEffect(() => { if (d.known) call("audio_meter", { selected: selectedOnly }); }, [selectedOnly, d.known, d.applied]);
  useEffect(() => () => { call("audio_meter", { selected: false }); }, []);
}

const subVol = (cb: () => void) => { volSubs.add(cb); return () => { volSubs.delete(cb); }; };
const getVol = () => volState;

export function useVolume(): VolumeState {
  useEffect(() => { startAudio(); }, []);
  return useSyncExternalStore(subVol, getVol);
}

export function setVolume(v: number) {
  const vol = Math.max(0, Math.min(1, v));
  const wasMuted = volState.mute;
  ignoreUntil = performance.now() + 700;
  volState = { vol, mute: false, ok: true };
  notifyVol();
  call("set_volume", { level: vol });
  if (wasMuted && vol > 0) call("set_mute", { mute: false });
}

export function toggleMute() {
  ignoreUntil = performance.now() + 700;
  volState = { ...volState, mute: !volState.mute, ok: true };
  notifyVol();
  call("set_mute", { mute: volState.mute });
}

/** Niveau normalisé 0..1 pour l'animation (gain automatique : fonctionne à tout volume) */
export function audioLevel(now: number): number {
  const fresh = now - audioBus.at < 400;
  const p = fresh ? audioBus.peak : 0;
  audioBus.agc = Math.max(p, audioBus.agc * 0.9985, 0.06);
  return Math.min(1, p / audioBus.agc);
}

// ───────────── Lecture en cours (Windows : SMTC · Linux : MPRIS via playerctl) ─────────────
export interface MediaState {
  on: boolean; app: string; key: string; title: string; artist: string; album: string;
  playing: boolean; pos: number; dur: number; at: number; art: string | null;
  /** Diagnostic quand rien n'est affiché : erreur du démon + applications média vues par Windows */
  err: string; sessions: string[];
}

const EMPTY: MediaState = { on: false, app: "", key: "", title: "", artist: "", album: "", playing: false, pos: 0, dur: 0, at: 0, art: null, err: "", sessions: [] };
let media: MediaState = EMPTY;
const mediaSubs = new Set<() => void>();
let mediaStarted = false;

/** Pochette de secours : si le lecteur n'en a pas fourni au bout de 3,5 s, on la cherche (artiste + titre) côté Rust */
let coverAsked = "";
function scheduleCover() {
  if (!media.on || !media.title || media.art || media.key === coverAsked) return;
  const key = media.key;
  coverAsked = key;
  window.setTimeout(async () => {
    if (media.key !== key || media.art) return;
    const url = await call<string>("fetch_cover", { artist: media.artist, title: media.title });
    if (url && media.key === key && !media.art) { media = { ...media, art: url }; mediaSubs.forEach((f) => f()); }
  }, 3500);
}

function startMedia() {
  if (mediaStarted) return;
  mediaStarted = true;
  on<string>("halo-media", (line) => {
    if (!line.startsWith("M|")) return;
    daemonSeenAt = performance.now();
    let j: Record<string, unknown>;
    try { j = JSON.parse(line.slice(2)); } catch { return; }
    if (!j.on) {
      const err = String(j.err ?? "");
      const sessions = Array.isArray(j.sessions) ? j.sessions.map(String) : [];
      if (media.on || media.err !== err || media.sessions.join("|") !== sessions.join("|")) {
        media = { ...EMPTY, err, sessions };
        mediaSubs.forEach((f) => f());
      }
      return;
    }
    const key = String(j.key ?? "");
    const sameTrack = key === media.key;
    // Windows envoie du JPEG ; Linux précise le type réel (png, webp…) dans "mime"
    const mime = typeof j.mime === "string" && j.mime.startsWith("image/") ? j.mime : "image/jpeg";
    // Pochette absente du message : on garde celle du même morceau (y compris une pochette de secours déjà trouvée)
    const art = typeof j.art === "string" && j.art ? `data:${mime};base64,${j.art}` : sameTrack ? media.art : null;
    media = {
      on: true, app: String(j.app ?? ""), key,
      title: String(j.title ?? ""), artist: String(j.artist ?? ""), album: String(j.album ?? ""),
      playing: !!j.playing, pos: Number(j.pos) || 0, dur: Number(j.dur) || 0, at: performance.now(), art, err: "", sessions: [],
    };
    mediaSubs.forEach((f) => f());
    scheduleCover();
  });
  // Demande l'envoi de la pochette (le démon ne l'envoie qu'une fois par morceau)
  setTimeout(() => call("media_control", { action: "resend" }), 700);
}

const subMedia = (cb: () => void) => { mediaSubs.add(cb); return () => { mediaSubs.delete(cb); }; };
const getMedia = () => media;

export function useMedia(): MediaState {
  useEffect(() => { startMedia(); }, []);
  return useSyncExternalStore(subMedia, getMedia);
}

export function mediaCmd(action: "toggle" | "next" | "prev" | "seek" | "only", value?: number) {
  if (action === "toggle" && media.on) { media = { ...media, playing: !media.playing, pos: mediaPos(media), at: performance.now() }; mediaSubs.forEach((f) => f()); }
  call("media_control", { action, value });
}

export function mediaPos(m: MediaState): number {
  if (!m.playing) return m.pos;
  const p = m.pos + (performance.now() - m.at) / 1000;
  return m.dur > 0 ? Math.min(p, m.dur) : p;
}

/** Position de lecture qui avance en douceur entre deux messages du démon */
export function useMediaPos(m: MediaState, everyMs = 500): number {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!m.playing) return;
    const id = window.setInterval(() => tick((t) => t + 1), everyMs);
    return () => clearInterval(id);
  }, [m.playing, everyMs]);
  return mediaPos(m);
}

/** Vrai tant que le service système (PowerShell sous Windows, MPRIS sous Linux) répond (laisse 10 s au démarrage) */
export function useDaemonAlive(): boolean {
  const [, tick] = useState(0);
  useEffect(() => { const id = window.setInterval(() => tick((t) => t + 1), 2000); return () => clearInterval(id); }, []);
  const now = performance.now();
  return daemonSeenAt ? now - daemonSeenAt < 8000 : now - bootAt < 10000;
}

export const isSpotify = (app: string) => /spotify/i.test(app);
