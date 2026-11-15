import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Info, RotateCcw, TriangleAlert, X } from "lucide-react";

/** Section d'une page de Réglages. Les sections hors écran ne sont pas calculées tant qu'on n'y défile pas (pages longues plus fluides). */
export function Section({ title, desc, children, action }: { title: string; desc?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="halo-sec mb-6" data-section={title}>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {desc && <p className="mt-0.5 text-xs mono-dim">{desc}</p>}
        </div>
        {action}
      </div>
      <div className="mt-3 overflow-hidden rounded-xl border" style={{ background: "var(--surface-2)", borderColor: "var(--stroke)" }}>{children}</div>
    </section>
  );
}

/** Ligne de réglage. `data-setting` / `data-hint` alimentent la recherche dans les Réglages. */
export function Row({ label, hint, children, stack, off }: { label: string; hint?: string; children: ReactNode; stack?: boolean; off?: boolean }) {
  // `off` : réglage sans effet pour l'instant (grisé, non utilisable) mais toujours visible et retrouvable par la recherche
  const mark = (el: HTMLDivElement | null) => { if (el) { if (off) el.setAttribute("inert", ""); else el.removeAttribute("inert"); } };
  return (
    <div ref={mark} data-setting={label} aria-disabled={off || undefined}
      className={`flex gap-4 border-b px-4 py-3 transition-opacity last:border-b-0 ${stack ? "flex-col" : "items-center justify-between"}`}
      style={{ borderColor: "var(--stroke)", opacity: off ? 0.45 : 1 }}>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{label}</div>
        {hint && <div data-hint className="mt-0.5 text-[11px] leading-snug mono-dim">{hint}</div>}
      </div>
      <div className={stack ? "w-full" : "shrink-0"}>{children}</div>
    </div>
  );
}

/** Titre de page avec, en option, un bouton « Rétablir cette page » (deux clics pour confirmer) */
export function PageHeader({ title, desc, onReset, resetLabel = "Rétablir cette page" }: { title: string; desc?: string; onReset?: () => void; resetLabel?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 3500);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-bold">{title}</h1>
        {desc && <p className="mt-1 text-xs leading-relaxed mono-dim">{desc}</p>}
      </div>
      {onReset && (
        <Btn variant={armed ? "accent" : "default"} onClick={() => { if (armed) { setArmed(false); onReset(); } else setArmed(true); }}>
          <RotateCcw size={13} />{armed ? "Confirmer ?" : resetLabel}
        </Btn>
      )}
    </div>
  );
}

/** Encadré d'information ou d'avertissement */
export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  const I = tone === "warn" ? TriangleAlert : Info;
  return (
    <div role="note" className="mb-5 flex gap-2.5 rounded-xl border px-3.5 py-3 text-xs leading-relaxed"
      style={{ borderColor: tone === "warn" ? "color-mix(in srgb, var(--accent) 55%, transparent)" : "var(--stroke)", background: "var(--surface-2)" }}>
      <I size={15} className="mt-px shrink-0" style={{ color: tone === "warn" ? "var(--accent)" : "var(--text-dim)" }} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={value} aria-label={label} onClick={() => onChange(!value)}
      className="relative h-6 w-10 rounded-full transition-colors" style={{ background: value ? "var(--accent)" : "var(--stroke-strong)" }}>
      <span className="halo-switch-knob absolute top-0.5 h-5 w-5 rounded-full bg-white shadow" style={{ left: value ? 18 : 2 }} />
    </button>
  );
}

/** Curseur fluide : la valeur affichée suit la souris à chaque image, les réglages sont appliqués une fois par image (pas à chaque pixel).
 *  `def` : valeur d'origine ; si elle est donnée, un bouton ↺ (ou un double-clic sur le curseur) la rétablit. */
export function Slider({ value, min, max, step = 1, onChange, label, format, width = 180, def }: {
  value: number; min: number; max: number; step?: number; onChange: (v: number) => void; label: string; format?: (v: number) => string; width?: number; def?: number;
}) {
  const [draft, setDraft] = useState(value);
  const held = useRef(false), raf = useRef(0), last = useRef(value), cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => { if (!held.current) { setDraft(value); last.current = value; } }, [value]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const push = (v: number) => {
    last.current = v;
    setDraft(v);
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => cb.current(last.current));
  };
  const release = () => {
    if (!held.current) return;
    held.current = false;
    cancelAnimationFrame(raf.current);
    cb.current(last.current); // dernière valeur garantie
  };
  const p = ((draft - min) / (max - min)) * 100;
  const dirty = def !== undefined && Math.abs(value - def) > step / 2;
  return (
    <div className="flex items-center gap-3">
      <input type="range" aria-label={label} min={min} max={max} step={step} value={draft}
        onChange={(e) => push(+e.target.value)}
        onPointerDown={() => { held.current = true; }} onPointerUp={release} onPointerCancel={release} onBlur={release}
        onDoubleClick={def !== undefined ? () => push(def) : undefined}
        className="halo-range" style={{ width, ["--p" as string]: `${p}%` }} />
      <span className="w-14 text-right text-xs tabular-nums mono-dim">{format ? format(draft) : draft}</span>
      {def !== undefined && (
        <button type="button" aria-label={`Rétablir ${label}`} title="Rétablir la valeur d'origine" disabled={!dirty} onClick={() => push(def)}
          className="flex h-6 w-6 items-center justify-center rounded-md transition-opacity hover:bg-white/10 disabled:opacity-0"><RotateCcw size={12} /></button>
      )}
    </div>
  );
}

/** Choix parmi quelques options ; la pastille de sélection glisse d'une option à l'autre */
export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  const [ready, setReady] = useState(false); // pas d'animation au tout premier affichage
  const measure = useCallback(() => {
    const el = wrap.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (el && el.offsetWidth) setPill((p) => (p && p.x === el.offsetLeft && p.w === el.offsetWidth ? p : { x: el.offsetLeft, w: el.offsetWidth }));
  }, []);
  useLayoutEffect(measure, [measure, value, options.length]);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const t = requestAnimationFrame(() => setReady(true));
    return () => { ro.disconnect(); cancelAnimationFrame(t); };
  }, [measure]);
  return (
    <div ref={wrap} role="radiogroup" aria-label={label} className="relative flex rounded-lg p-0.5" style={{ background: "var(--surface-3)" }}>
      {pill && (
        <span aria-hidden className="pointer-events-none absolute bottom-0.5 left-0 top-0.5 rounded-md"
          style={{
            width: pill.w, transform: `translateX(${pill.x}px)`, background: "var(--accent)",
            transition: ready ? "transform calc(.28s / var(--speed)) cubic-bezier(.3, 1.2, .5, 1), width calc(.28s / var(--speed)) cubic-bezier(.3, 1.2, .5, 1)" : "none",
          }} />
      )}
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}
          className="relative z-10 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
          style={{ color: o.value === value ? "var(--accent-fg)" : "var(--text-dim)" }}>{o.label}</button>
      ))}
    </div>
  );
}

export function Select<T extends string = string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}
      className="rounded-lg border px-2.5 py-1.5 text-xs outline-none" style={{ background: "var(--surface-3)", borderColor: "var(--stroke)", color: "var(--text)" }}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function TextInput({ value, onChange, placeholder, label, width = 260 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; label: string; width?: number | string;
}) {
  return (
    <input type="text" aria-label={label} value={value} placeholder={placeholder} spellCheck={false} onChange={(e) => onChange(e.target.value)}
      style={{ width, background: "var(--surface-3)", borderColor: "var(--stroke)", color: "var(--text)" }}
      className="select-text rounded-lg border px-2.5 py-1.5 text-xs outline-none placeholder:text-[var(--text-dim)]" />
  );
}

export function Btn({ children, onClick, variant = "default", disabled, label }: {
  children: ReactNode; onClick: () => void; variant?: "default" | "accent" | "danger"; disabled?: boolean; label?: string;
}) {
  const st = variant === "accent" ? { background: "var(--accent)", color: "var(--accent-fg)" }
    : variant === "danger" ? { background: "transparent", color: "var(--accent)", border: "1px solid var(--stroke-strong)" }
    : { background: "var(--surface-3)", color: "var(--text)" };
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label}
      className="halo-press flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold hover:opacity-85 disabled:opacity-40" style={st}>{children}</button>
  );
}

// ───────────── Raccourcis clavier ─────────────
const KEY_LABEL: Record<string, string> = { Space: "Espace", Up: "↑", Down: "↓", Left: "←", Right: "→", Enter: "Entrée", Delete: "Suppr", Insert: "Inser", PageUp: "Page ↑", PageDown: "Page ↓", Home: "Début", End: "Fin" };

/** Une touche sous forme de pastille */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-6 items-center justify-center rounded-md border px-1.5 py-0.5 font-sans text-[11px] font-semibold"
      style={{ background: "var(--surface-3)", borderColor: "var(--stroke-strong)", color: "var(--text)" }}>{children}</kbd>
  );
}

/** « Ctrl+Alt+K » → pastilles */
export function KeyCombo({ accel }: { accel: string }) {
  if (!accel) return <span className="text-xs mono-dim">Désactivé</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {accel.split("+").map((k, i) => <Kbd key={i}>{KEY_LABEL[k] ?? k}</Kbd>)}
    </span>
  );
}

const NAMED_KEYS: Record<string, string> = {
  Space: "Space", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Enter: "Enter", Tab: "Tab",
  Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Insert: "Insert", Delete: "Delete",
};

/** Touche principale d'un événement clavier, ou null (touche de modification seule, touche non gérée).
 *  Les lettres suivent la touche réellement imprimée (AZERTY compris), comme le fait l'enregistrement du raccourci global. */
export function keyFromEvent(e: KeyboardEvent): string | null {
  if (/^F([1-9]|1\d|2[0-4])$/.test(e.code)) return e.code;
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
  if (/^Numpad\d$/.test(e.code)) return null;
  if (NAMED_KEYS[e.code]) return NAMED_KEYS[e.code];
  if (/^[a-z]$/i.test(e.key)) return e.key.toUpperCase();
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  return null;
}

/** Accélérateur (« Ctrl+Alt+K ») pour un événement clavier ; une touche de fonction peut être seule, les autres exigent Ctrl, Alt ou Maj */
export function accelFromEvent(e: KeyboardEvent): string | null {
  const key = keyFromEvent(e);
  if (!key) return null;
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift"].filter(Boolean) as string[];
  if (!mods.length && !/^F\d+$/.test(key)) return null;
  return [...mods, key].join("+");
}

/** Champ d'enregistrement d'un raccourci : clic, puis on appuie sur la combinaison voulue (Échap : annuler · Retour arrière : désactiver) */
export function ShortcutInput({ value, onChange, label, def }: { value: string; onChange: (v: string) => void; label: string; def: string }) {
  const [rec, setRec] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!rec) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation(); // Échap ne doit pas fermer la fenêtre Réglages pendant l'enregistrement
      if (e.key === "Escape") { setRec(false); return; }
      if (e.key === "Backspace") { onChange(""); setRec(false); return; }
      const acc = accelFromEvent(e);
      if (acc) { onChange(acc); setRec(false); }
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [rec, onChange]);
  return (
    <div className="flex items-center gap-1.5">
      <button ref={btn} type="button" aria-label={label} onClick={() => setRec((r) => !r)} onBlur={() => setRec(false)}
        className="halo-press flex h-8 min-w-36 items-center justify-center rounded-lg border px-3 text-xs"
        style={{ background: "var(--surface-3)", borderColor: rec ? "var(--accent)" : "var(--stroke)", boxShadow: rec ? "0 0 0 3px color-mix(in srgb, var(--accent) 28%, transparent)" : "none" }}>
        {rec ? <span className="mono-dim">Appuie sur les touches…</span> : <KeyCombo accel={value} />}
      </button>
      <button type="button" aria-label={`Désactiver ${label}`} title="Désactiver ce raccourci" disabled={!value} onClick={() => onChange("")}
        className="flex h-7 w-7 items-center justify-center rounded-md transition-opacity hover:bg-white/10 disabled:opacity-0"><X size={13} /></button>
      <button type="button" aria-label={`Rétablir ${label}`} title="Rétablir le raccourci d'origine" disabled={value === def} onClick={() => onChange(def)}
        className="flex h-7 w-7 items-center justify-center rounded-md transition-opacity hover:bg-white/10 disabled:opacity-0"><RotateCcw size={12} /></button>
    </div>
  );
}
