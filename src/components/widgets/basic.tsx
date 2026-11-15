import { useEffect, useMemo, useState } from "react";
import { Cpu, MemoryStick } from "lucide-react";
import { call } from "../../lib/tauri";
import { updateWidget, useSettings } from "../../lib/settings";
import { useActive } from "../../lib/active";
import { useNow as useClockNow } from "../../lib/clock";
import { asBg, Surface, type WProps } from "./common";

/** Toutes les `ms` ms (calendrier, système) */
function useNow(ms = 1000) {
  const [t, setT] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setT(new Date()), ms); return () => clearInterval(id); }, [ms]);
  return t;
}

// ───────────── Horloge ─────────────
function Analog({ t, seconds, size = 170 }: { t: Date; seconds: boolean; size?: number }) {
  const h = (t.getHours() % 12) + t.getMinutes() / 60, m = t.getMinutes() + t.getSeconds() / 60, s = t.getSeconds();
  const hand = (deg: number, len: number, w: number, color: string) => (
    <line x1="50" y1="50" x2="50" y2={50 - len} stroke={color} strokeWidth={w} strokeLinecap="round" transform={`rotate(${deg} 50 50)`} />
  );
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Horloge analogique">
      {Array.from({ length: 60 }, (_, i) => {
        const big = i % 5 === 0, a = (i * 6 * Math.PI) / 180;
        const r1 = big ? 40 : 43.5, r2 = 46.5;
        return <line key={i} x1={50 + Math.sin(a) * r1} y1={50 - Math.cos(a) * r1} x2={50 + Math.sin(a) * r2} y2={50 - Math.cos(a) * r2}
          stroke="var(--text)" strokeOpacity={big ? 0.9 : 0.35} strokeWidth={big ? 1.6 : 0.8} strokeLinecap="round" />;
      })}
      {hand(h * 30, 24, 3, "var(--text)")}
      {hand(m * 6, 36, 2, "var(--text)")}
      {seconds && hand(s * 6, 40, 0.9, "var(--accent)")}
      <circle cx="50" cy="50" r="2.4" fill="var(--accent)" />
    </svg>
  );
}

export function ClockWidget({ opts }: WProps) {
  const locale = useSettings((s) => s.clock.locale);
  const seconds = !!opts.seconds, hour12 = !!opts.hour12, showDate = opts.date !== false;
  const t = useClockNow(seconds || (opts.style as string) === "analog"); // minuteur à la seconde seulement si elle est visible
  const style = (opts.style as string) ?? "big";
  const lc = locale || undefined;
  const time = t.toLocaleTimeString(lc, { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hourCycle: hour12 ? "h12" : "h23" });
  const date = t.toLocaleDateString(lc, { weekday: "long", day: "numeric", month: "long" });

  if (style === "big") {
    return (
      <div className="pointer-events-none text-center" style={{ color: "var(--clock-color, var(--text))", textShadow: "0 4px 40px rgba(0,0,0,.25)" }}>
        <div className="font-extrabold leading-none tracking-tight tabular-nums" style={{ fontSize: 170 }}>{time}</div>
        {showDate && <div className="mt-3 text-[22px] font-medium capitalize" style={{ opacity: 0.8 }}>{date}</div>}
      </div>
    );
  }
  const bg = asBg(opts.bg, "glass");
  if (style === "analog") {
    return (
      <Surface bg={bg} label="Horloge" className="flex flex-col items-center gap-2 rounded-[var(--radius)] p-4">
        <Analog t={t} seconds={seconds} />
        {showDate && <div className="text-xs font-medium capitalize mono-dim">{date}</div>}
      </Surface>
    );
  }
  return (
    <Surface bg={bg} label="Horloge" className="rounded-[var(--radius)] px-5 py-3.5">
      <div className="text-[46px] font-bold leading-none tracking-tight tabular-nums">{time}</div>
      {showDate && <div className="mt-1.5 text-[13px] font-medium capitalize mono-dim">{date}</div>}
    </Surface>
  );
}

// ───────────── Calendrier ─────────────
export function CalendarWidget({ opts }: WProps) {
  const locale = useSettings((s) => s.clock.locale);
  const d = useNow(60_000);
  const y = d.getFullYear(), m = d.getMonth();
  const cells = useMemo(() => {
    const lead = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
    return [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)] as (number | null)[];
  }, [y, m]);
  // Initiales des jours (lundi en premier), dans la langue choisie
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(locale || undefined, { weekday: "narrow" })), [locale]);
  return (
    <Surface bg={asBg(opts.bg, "glass")} label="Calendrier" className="w-56 rounded-[var(--radius)] p-3.5">
      <h2 className="mb-2 text-xs font-semibold capitalize">{d.toLocaleDateString(locale || undefined, { month: "long", year: "numeric" })}</h2>
      <div className="grid grid-cols-7 gap-y-1 text-center text-[11px]">
        {days.map((l, i) => <span key={i} className="mono-dim">{l}</span>)}
        {cells.map((n, i) => (
          <span key={i} className="mx-auto flex h-6 w-6 items-center justify-center rounded-full tabular-nums"
            style={n === d.getDate() ? { background: "var(--accent)", color: "var(--accent-fg)" } : undefined}>{n}</span>
        ))}
      </div>
    </Surface>
  );
}

// ───────────── Système ─────────────
function Bar({ icon, label, v }: { icon: React.ReactNode; label: string; v: number }) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="mono-dim">{icon}</span><span className="w-9">{label}</span>
      <div className="h-1.5 flex-1 rounded-full" style={{ background: "var(--stroke-strong)" }}>
        <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.min(100, v)}%`, background: "var(--text)" }} />
      </div>
      <span className="w-9 text-right tabular-nums">{Math.round(v)}%</span>
    </div>
  );
}

export function SystemWidget({ opts }: WProps) {
  const [s, setS] = useState({ cpu: 0, ram: 0 });
  const active = useActive();
  useEffect(() => {
    if (!active) return;
    const tick = () => call<{ cpu: number; ram: number }>("system_stats").then((r) => r && setS(r));
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, [active]);
  const cpu = opts.cpu !== false, ram = opts.ram !== false;
  return (
    <Surface bg={asBg(opts.bg, "glass")} label="Système" className="grid w-56 gap-2.5 rounded-[var(--radius)] p-3.5">
      {cpu && <Bar icon={<Cpu size={14} />} label="CPU" v={s.cpu} />}
      {ram && <Bar icon={<MemoryStick size={14} />} label="RAM" v={s.ram} />}
      {!cpu && !ram && <p className="text-xs mono-dim">Rien à afficher</p>}
    </Surface>
  );
}

// ───────────── Notes ─────────────
export function NotesWidget({ id, opts, edit }: WProps) {
  const text = typeof opts.text === "string" ? opts.text : "";
  const title = typeof opts.title === "string" ? opts.title : "Notes";
  return (
    <Surface bg={asBg(opts.bg, "glass")} label={title} className="flex h-52 w-60 flex-col gap-2 rounded-[var(--radius)] p-3.5">
      <h2 className="text-xs font-semibold">{title}</h2>
      <textarea value={text} disabled={edit} spellCheck={false} placeholder="Écris ici…"
        onChange={(e) => updateWidget(id, (w) => ({ ...w, opts: { ...w.opts, text: e.target.value } }))}
        className="min-h-0 flex-1 resize-none select-text bg-transparent text-[13px] leading-relaxed outline-none placeholder:text-[var(--text-dim)]" />
    </Surface>
  );
}
