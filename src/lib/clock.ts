import { useEffect, useState } from "react";
import type { Settings } from "./settings";

type ClockCfg = Settings["clock"];

// Les formateurs Intl coûtent cher à créer : on les garde par langue et par options
const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(locale: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = locale + "|" + JSON.stringify(opts);
  let f = cache.get(key);
  if (!f) {
    try { f = new Intl.DateTimeFormat(locale || undefined, opts); } catch { f = new Intl.DateTimeFormat(undefined, opts); }
    cache.set(key, f);
  }
  return f;
}

/** Heure selon les réglages (24 h / 12 h, secondes, langue) */
export function fmtTime(d: Date, c: ClockCfg, seconds: boolean = c.seconds): string {
  // hourCycle (et non hour12:false) : évite « 24:05 » après minuit dans certaines langues
  return fmt(c.locale, { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" as const } : {}), hourCycle: c.hour12 ? "h12" : "h23" }).format(d);
}

/** Date selon les réglages (style, jour de la semaine, langue) ; chaîne vide si la date est masquée par le style « aucune » */
export function fmtDate(d: Date, c: ClockCfg, style: ClockCfg["dateStyle"] = c.dateStyle): string {
  if (style === "none") return "";
  const o: Intl.DateTimeFormatOptions = style === "numeric"
    ? { ...(c.weekday ? { weekday: "short" as const } : {}), day: "2-digit", month: "2-digit" }
    : { ...(c.weekday ? { weekday: style === "long" ? ("long" as const) : ("short" as const) } : {}), day: "numeric", month: style === "long" ? "long" : "short" };
  return fmt(c.locale, o).format(d);
}

/** Date courante, mise à jour au changement de seconde (ou de minute) : un seul minuteur, aligné sur l'horloge, sans dérive.
 *  `active` à faux (fenêtre masquée) : le minuteur s'arrête. */
export function useNow(seconds: boolean, active = true): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    let t = 0;
    const tick = () => {
      const d = new Date();
      setNow(d);
      const wait = seconds ? 1000 - d.getMilliseconds() : 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds());
      t = window.setTimeout(tick, Math.max(50, wait + 20));
    };
    tick();
    return () => clearTimeout(t);
  }, [seconds, active]);
  return now;
}

/** Langues proposées pour l'heure et la date (la valeur vide suit celle de Windows) */
export const LOCALES: { value: string; label: string }[] = [
  { value: "", label: "Langue du système" },
  { value: "fr-FR", label: "Français (France)" },
  { value: "fr-BE", label: "Français (Belgique)" },
  { value: "fr-CA", label: "Français (Canada)" },
  { value: "fr-CH", label: "Français (Suisse)" },
  { value: "en-US", label: "English (United States)" },
  { value: "en-GB", label: "English (United Kingdom)" },
  { value: "en-CA", label: "English (Canada)" },
  { value: "de-DE", label: "Deutsch" },
  { value: "es-ES", label: "Español" },
  { value: "it-IT", label: "Italiano" },
  { value: "pt-PT", label: "Português (Portugal)" },
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "nl-NL", label: "Nederlands" },
  { value: "sv-SE", label: "Svenska" },
  { value: "pl-PL", label: "Polski" },
  { value: "tr-TR", label: "Türkçe" },
  { value: "ru-RU", label: "Русский" },
  { value: "ja-JP", label: "日本語" },
  { value: "ko-KR", label: "한국어" },
  { value: "zh-CN", label: "中文（简体）" },
];
