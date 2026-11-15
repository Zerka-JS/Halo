import { Moon, Sun, Monitor } from "lucide-react";
import { ACCENTS, DEFAULTS, RESET_GROUPS, resetKeys, updateSettings, useSettings, type FontChoice, type Settings, type ThemeMode } from "../../lib/settings";
import { FONT_STACKS } from "../../lib/theme";
import { PageHeader, Row, Section, Segmented, Select, Slider, Toggle } from "../../components/ui";

/** Styles prêts à l'emploi : règlent d'un coup l'opacité, le flou, l'arrondi et les détails du verre */
interface Preset { id: string; name: string; desc: string; v: { glass: number; blur: number; radius: number; glassFx: Settings["glassFx"] } }
const PRESETS: Preset[] = [
  { id: "glass", name: "Verre", desc: "Équilibré (par défaut)", v: { glass: 0.52, blur: 28, radius: 18, glassFx: { saturate: 140, border: 1, shadow: 1 } } },
  { id: "crystal", name: "Cristal", desc: "Très transparent, reflets vifs", v: { glass: 0.3, blur: 40, radius: 22, glassFx: { saturate: 180, border: 1.4, shadow: 1.2 } } },
  { id: "soft", name: "Doux", desc: "Très arrondi, contours discrets", v: { glass: 0.45, blur: 24, radius: 32, glassFx: { saturate: 130, border: 0.6, shadow: 0.7 } } },
  { id: "matte", name: "Mat", desc: "Presque opaque, peu de flou", v: { glass: 0.85, blur: 6, radius: 14, glassFx: { saturate: 100, border: 0.8, shadow: 0.8 } } },
  { id: "flat", name: "Plat", desc: "Aucun flou ni ombre", v: { glass: 0.92, blur: 0, radius: 8, glassFx: { saturate: 100, border: 1, shadow: 0 } } },
];
const same = (a: number, b: number) => Math.abs(a - b) < 0.011;
const matches = (s: Settings, p: Preset) =>
  same(s.glass, p.v.glass) && s.blur === p.v.blur && s.radius === p.v.radius &&
  s.glassFx.saturate === p.v.glassFx.saturate && same(s.glassFx.border, p.v.glassFx.border) && same(s.glassFx.shadow, p.v.glassFx.shadow);

const FONTS: { value: FontChoice; label: string }[] = [
  { value: "inter", label: "Inter (par défaut)" }, { value: "system", label: "Windows (Segoe UI)" },
  { value: "serif", label: "Serif (Georgia)" }, { value: "mono", label: "Monospace (Cascadia)" },
];

export default function AppearancePage() {
  const s = useSettings();
  const set = (p: Partial<Settings>) => updateSettings((x) => ({ ...x, ...p }));
  const setFx = (p: Partial<Settings["glassFx"]>) => updateSettings((x) => ({ ...x, glassFx: { ...x.glassFx, ...p } }));
  const setA11y = (p: Partial<Settings["a11y"]>) => updateSettings((x) => ({ ...x, a11y: { ...x.a11y, ...p } }));

  return (
    <>
      <PageHeader title="Apparence" desc="Thème, couleurs, matière du verre, police et accessibilité." onReset={() => resetKeys(RESET_GROUPS.appearance.keys)} />

      <div className="relative mb-6 h-32 overflow-hidden rounded-2xl border" style={{ borderColor: "var(--stroke-strong)", background: "linear-gradient(120deg,#3b2a5c,#e5484d 55%,#f5b400)" }} aria-hidden>
        <div className="glass absolute left-5 top-5 flex h-[72px] w-56 items-center gap-3 rounded-[var(--radius)] px-4">
          <span className="h-8 w-8 rounded-full" style={{ background: "var(--accent)" }} />
          <div><div className="text-xs font-semibold">Aperçu</div><div className="text-[11px] mono-dim">Verre, accent, arrondi</div></div>
        </div>
        <div className="glass absolute bottom-4 right-5 flex gap-2 rounded-[var(--radius)] p-2">
          {[0, 1, 2].map((i) => <span key={i} className="h-8 w-8 rounded-[22%]" style={{ background: "var(--glass-strong)", border: "1px solid var(--stroke)" }} />)}
        </div>
      </div>

      <Section title="Thème">
        <Row label="Mode">
          <Segmented<ThemeMode> label="Thème" value={s.theme} onChange={(v) => set({ theme: v })} options={[
            { value: "dark", label: <><Moon size={13} />Sombre</> }, { value: "light", label: <><Sun size={13} />Clair</> }, { value: "auto", label: <><Monitor size={13} />Auto</> }]} />
        </Row>
        <Row label="Couleur d'accent" hint="Jour du calendrier, curseurs, boutons actifs…" stack>
          <div className="flex flex-wrap items-center gap-2">
            {ACCENTS.map((c) => (
              <button key={c} type="button" aria-label={`Accent ${c}`} aria-pressed={s.accent.toLowerCase() === c} onClick={() => set({ accent: c })}
                className="h-7 w-7 rounded-full transition-transform hover:scale-110"
                style={{ background: c, outline: s.accent.toLowerCase() === c ? "2px solid var(--text)" : "none", outlineOffset: 2 }} />
            ))}
            <label className="ml-1 flex items-center gap-2 text-xs mono-dim">Perso
              <input type="color" aria-label="Couleur d'accent personnalisée" value={s.accent} onChange={(e) => set({ accent: e.target.value })} className="h-7 w-10 cursor-pointer rounded border-0 bg-transparent" />
            </label>
          </div>
        </Row>
        <Row label="Police" hint="Pour la barre, le dock, les widgets et ces réglages." stack>
          <div className="flex flex-wrap items-center gap-3">
            <Select<FontChoice> label="Police" value={s.font} onChange={(v) => set({ font: v })} options={FONTS} />
            <span className="text-[15px]" style={{ fontFamily: FONT_STACKS[s.font] }}>Aa — Les chaussettes de l'archiduchesse 0123</span>
          </div>
        </Row>
      </Section>

      <Section title="Styles prêts à l'emploi" desc="Un clic règle l'opacité, le flou, l'arrondi et les détails du verre ; tu peux ensuite affiner ci-dessous.">
        <div role="radiogroup" aria-label="Style du verre" className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 xl:grid-cols-5">
          {PRESETS.map((p) => {
            const on = matches(s, p);
            return (
              <button key={p.id} type="button" role="radio" aria-checked={on} onClick={() => set({ glass: p.v.glass, blur: p.v.blur, radius: p.v.radius, glassFx: p.v.glassFx })}
                className="halo-press rounded-xl border p-2 text-left transition-colors"
                style={{ borderColor: on ? "var(--accent)" : "var(--stroke)", background: on ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "var(--surface-3)" }}>
                <div className="relative mb-2 h-14 overflow-hidden rounded-lg" style={{ background: "linear-gradient(120deg,#3b2a5c,#e5484d 55%,#f5b400)" }} aria-hidden>
                  <div className="absolute inset-x-2 bottom-2 top-2"
                    style={{
                      background: `rgb(var(--glass-rgb) / ${p.v.glass})`, backdropFilter: p.v.blur ? `blur(${Math.round(p.v.blur / 3)}px) saturate(${p.v.glassFx.saturate}%)` : undefined,
                      borderRadius: Math.min(p.v.radius * 0.7, 20), border: `1px solid rgb(var(--stroke-rgb) / ${0.12 * p.v.glassFx.border})`,
                      boxShadow: `0 6px 14px rgb(0 0 0 / ${0.3 * p.v.glassFx.shadow})`,
                    }} />
                </div>
                <div className="text-xs font-semibold">{p.name}</div>
                <div className="text-[10.5px] leading-snug mono-dim">{p.desc}</div>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Verre et formes" desc="Opacité, flou et arrondi : barre du haut, dock, widgets et menus.">
        <Row label="Opacité du verre"><Slider label="Opacité du verre" def={Math.round(DEFAULTS.glass * 100)} value={Math.round(s.glass * 100)} min={10} max={95} onChange={(v) => set({ glass: v / 100 })} format={(v) => v + " %"} /></Row>
        <Row label="Flou d'arrière-plan" hint="Visible sur les widgets posés sur le fond d'écran. La barre du haut et le dock sont des fenêtres transparentes : le système n'y floute rien. Plafonné à 10 px en mode économie."><Slider label="Flou d'arrière-plan" def={DEFAULTS.blur} value={s.blur} min={0} max={60} onChange={(v) => set({ blur: v })} format={(v) => v + " px"} /></Row>
        <Row label="Arrondi des cartes"><Slider label="Arrondi des cartes" def={DEFAULTS.radius} value={s.radius} min={4} max={36} onChange={(v) => set({ radius: v })} format={(v) => v + " px"} /></Row>
      </Section>

      <Section title="Verre : détails" desc="Réglages fins de la matière : couleurs vives, contour et profondeur.">
        <Row label="Saturation des couleurs" hint="Intensité des couleurs du fond vues à travers le verre."><Slider label="Saturation du verre" def={DEFAULTS.glassFx.saturate} value={s.glassFx.saturate} min={100} max={220} step={5} onChange={(v) => setFx({ saturate: v })} format={(v) => v + " %"} /></Row>
        <Row label="Contour" hint="Épaisseur visuelle du liseré autour des cartes, de la barre et du dock."><Slider label="Contour" def={DEFAULTS.glassFx.border} value={Math.round(s.glassFx.border * 100)} min={0} max={250} step={10} onChange={(v) => setFx({ border: v / 100 })} format={(v) => v + " %"} /></Row>
        <Row label="Ombre portée" hint="Profondeur sous les cartes ; 0 % = à plat."><Slider label="Ombre portée" def={DEFAULTS.glassFx.shadow} value={Math.round(s.glassFx.shadow * 100)} min={0} max={200} step={10} onChange={(v) => setFx({ shadow: v / 100 })} format={(v) => v + " %"} /></Row>
      </Section>

      <Section title="Accessibilité" desc="Pour une meilleure lisibilité.">
        <Row label="Contraste renforcé" hint="Textes secondaires plus lisibles et contours plus marqués."><Toggle label="Contraste renforcé" value={s.a11y.contrast} onChange={(v) => setA11y({ contrast: v })} /></Row>
        <Row label="Réduire la transparence" hint="Barre, dock, widgets et menus deviennent presque opaques, sans flou."><Toggle label="Réduire la transparence" value={s.a11y.solid} onChange={(v) => setA11y({ solid: v })} /></Row>
      </Section>
    </>
  );
}
