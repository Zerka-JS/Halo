import type { ComponentType } from "react";
import { Activity, Calendar, Clock, Cpu, Music, StickyNote, type LucideIcon } from "lucide-react";
import { newId, type WidgetInstance, type WidgetType } from "../../lib/settings";
import type { WProps } from "./common";
import { CalendarWidget, ClockWidget, NotesWidget, SystemWidget } from "./basic";
import { SoundWidget } from "./Sound";
import { SpotifyEmbedWidget, SpotifyWidget } from "./Spotify";

export interface OptionDef {
  key: string; label: string; kind: "toggle" | "select" | "text" | "audio-device";
  def: unknown; choices?: { value: string; label: string }[]; placeholder?: string; hint?: string;
}

export interface WidgetMeta {
  type: WidgetType; name: string; desc: string; icon: LucideIcon; Component: ComponentType<WProps>;
  options: OptionDef[];
  /** position initiale */
  at: Pick<WidgetInstance, "ax" | "ay" | "x" | "y">;
  defaults: Record<string, unknown>;
}

const BG: OptionDef = {
  key: "bg", label: "Fond", kind: "select", def: "glass",
  choices: [{ value: "glass", label: "Verre" }, { value: "solid", label: "Opaque" }, { value: "none", label: "Transparent" }],
};

export const WIDGETS: Record<WidgetType, WidgetMeta> = {
  spotify: {
    type: "spotify", name: "Spotify · En lecture", desc: "Pastille (égaliseur, heure) qui s'agrandit au clic en lecteur : titre, pochette, progression et contrôles.",
    icon: Music, Component: SpotifyWidget, at: { ax: "c", ay: "t", x: 0, y: 40 }, defaults: { style: "island" },
    options: [
      { key: "style", label: "Style", kind: "select", def: "island", choices: [
        { value: "island", label: "Île (pastille → lecteur)" }, { value: "card", label: "Carte adaptative" }, { value: "compact", label: "Compact" }, { value: "cover", label: "Pochette" }, { value: "minimal", label: "Texte seul" }] },
      { key: "controls", label: "Boutons de contrôle", kind: "toggle", def: true },
      { key: "progress", label: "Barre de progression", kind: "toggle", def: true },
      { key: "centre", label: "Centre de la pastille (île)", kind: "select", def: "time", hint: "Ce qui s'affiche au milieu de la petite version. Le titre apparaît toujours quelques secondes quand un nouveau morceau est détecté.",
        choices: [{ value: "time", label: "Heure" }, { value: "title", label: "Titre du morceau" }, { value: "elapsed", label: "Temps écoulé" }] },
      { key: "autoclose", label: "Se réduit quand la souris s'éloigne (île)", kind: "toggle", def: true, hint: "Désactivé : l'île reste ouverte jusqu'à un clic ailleurs ou la touche Échap." },
      { key: "tint", label: "Accent aux couleurs de la pochette (île)", kind: "toggle", def: false },
      { key: "source", label: "Source", kind: "select", def: "any", hint: "Spotify est toujours prioritaire quand il joue. « Toute application » affiche aussi Spotify Web, YouTube, VLC…",
        choices: [{ value: "any", label: "Toute application" }, { value: "spotify", label: "Spotify uniquement" }] },
    ],
  },
  "spotify-embed": {
    type: "spotify-embed", name: "Spotify · Lecteur intégré", desc: "Colle un lien de playlist, album, artiste ou podcast Spotify.",
    icon: Music, Component: SpotifyEmbedWidget, at: { ax: "r", ay: "t", x: 24, y: 280 },
    defaults: { url: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M", size: "compact" },
    options: [
      { key: "url", label: "Lien Spotify", kind: "text", def: "", placeholder: "https://open.spotify.com/playlist/…", hint: "Playlist, album, artiste, titre, épisode ou émission." },
      { key: "size", label: "Taille", kind: "select", def: "compact", choices: [{ value: "compact", label: "Compact" }, { value: "full", label: "Liste complète" }] },
    ],
  },
  sound: {
    type: "sound", name: "Indicateur de son", desc: "Animation synchronisée sur le son réellement joué. Clic = muet, molette = volume. Tu choisis la sortie (casque, enceintes…).",
    icon: Activity, Component: SoundWidget, at: { ax: "r", ay: "t", x: 24, y: 56 }, defaults: { style: "disc" },
    options: [
      { key: "style", label: "Style", kind: "select", def: "disc", choices: [
        { value: "disc", label: "Disque de points" }, { value: "ring", label: "Anneau" }, { value: "bars", label: "Barres" }] },
      { key: "color", label: "Couleur", kind: "select", def: "text", choices: [{ value: "text", label: "Texte" }, { value: "accent", label: "Accent" }] },
      { key: "interactive", label: "Clic et molette actifs", kind: "toggle", def: true },
      { key: "output", label: "Sortie audio (casque, enceintes…)", kind: "audio-device", def: "",
        hint: "L'endroit où sort ton son (Spotify compris) : c'est cette sortie que règlent le clic muet et la molette. C'est le même choix que Réglages › Système › Sortie du volume." },
      { key: "follow", label: "Animer uniquement avec cette sortie", kind: "toggle", def: false,
        hint: "Désactivé : l'animation écoute toutes les sorties actives (utile avec Voicemeeter, Wave Link…). Activé : seul le son qui part vers la sortie choisie la fait bouger." },
      { key: "showOutput", label: "Afficher le nom de la sortie au survol", kind: "toggle", def: true },
      BG,
    ],
  },
  clock: {
    type: "clock", name: "Horloge", desc: "Grande horloge, carte compacte ou analogique.",
    icon: Clock, Component: ClockWidget, at: { ax: "c", ay: "t", x: 0, y: 130 }, defaults: { style: "big" },
    options: [
      { key: "style", label: "Style", kind: "select", def: "big", choices: [
        { value: "big", label: "Grande" }, { value: "compact", label: "Compacte" }, { value: "analog", label: "Analogique" }] },
      { key: "seconds", label: "Afficher les secondes", kind: "toggle", def: false },
      { key: "hour12", label: "Format 12 heures", kind: "toggle", def: false },
      { key: "date", label: "Afficher la date", kind: "toggle", def: true },
      { ...BG, hint: "Ne s'applique pas à la grande horloge." },
    ],
  },
  calendar: {
    type: "calendar", name: "Calendrier", desc: "Le mois en cours, jour actuel surligné.",
    icon: Calendar, Component: CalendarWidget, at: { ax: "l", ay: "t", x: 24, y: 56 }, defaults: {}, options: [BG],
  },
  system: {
    type: "system", name: "Système", desc: "Charge du processeur et de la mémoire.",
    icon: Cpu, Component: SystemWidget, at: { ax: "l", ay: "t", x: 24, y: 322 }, defaults: {},
    options: [
      { key: "cpu", label: "Processeur", kind: "toggle", def: true },
      { key: "ram", label: "Mémoire", kind: "toggle", def: true },
      BG,
    ],
  },
  notes: {
    type: "notes", name: "Notes", desc: "Un pense-bête toujours visible sur le bureau.",
    icon: StickyNote, Component: NotesWidget, at: { ax: "l", ay: "t", x: 300, y: 56 }, defaults: { title: "Notes", text: "" },
    options: [{ key: "title", label: "Titre", kind: "text", def: "Notes" }, BG],
  },
};

export const WIDGET_ORDER: WidgetType[] = ["spotify", "spotify-embed", "sound", "clock", "calendar", "system", "notes"];

/** Valeurs d'options effectives = valeurs par défaut du type + choix de l'utilisateur */
export function resolveOpts(w: WidgetInstance): Record<string, unknown> {
  const meta = WIDGETS[w.type];
  const base: Record<string, unknown> = {};
  for (const o of meta.options) base[o.key] = o.def;
  return { ...base, ...meta.defaults, ...w.opts };
}

export function makeWidget(type: WidgetType, existing: WidgetInstance[]): WidgetInstance {
  const meta = WIDGETS[type];
  const n = existing.filter((w) => w.type === type).length;
  return {
    id: newId(), type, ...meta.at,
    x: meta.at.x + (meta.at.ax === "c" ? 0 : n * 28), y: meta.at.y + n * 28,
    scale: 1, visible: true, opts: { ...meta.defaults },
  };
}
