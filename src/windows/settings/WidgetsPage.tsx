import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Eye, EyeOff, LayoutGrid, Plus, RotateCcw, Trash2 } from "lucide-react";
import { call, send } from "../../lib/tauri";
import { useAudioDevices } from "../../lib/sys";
import { DEFAULT_WIDGETS, DEFAULTS, newId, RESET_GROUPS, resetKeys, updateSettings, updateWidget, useSettings, type Settings, type WidgetInstance } from "../../lib/settings";
import { makeWidget, resolveOpts, WIDGET_ORDER, WIDGETS, type OptionDef } from "../../components/widgets/registry";
import { Btn, PageHeader, Row, Section, Select, Slider, TextInput, Toggle } from "../../components/ui";

/** Choix de la sortie audio : réglage global, partagé avec Réglages › Système › Sortie du volume */
function AudioOutputControl({ o }: { o: OptionDef }) {
  const audioDevice = useSettings((x) => x.audio.device);
  const dev = useAudioDevices();
  const names = dev.known ? dev.names : [];
  return (
    <Row label={o.label} hint={dev.known ? o.hint : "Halo n'a pas reçu la liste des sorties audio : ferme-le complètement puis relance-le (le choix ne marche pas dans un simple navigateur)."} stack off={!dev.known}>
      <Select<string> label={o.label} value={audioDevice} onChange={(v) => updateSettings((x) => ({ ...x, audio: { device: v } }))} options={[
        { value: "@auto", label: "Automatique (recommandé)" },
        { value: "", label: "Sortie par défaut de Windows" },
        ...names.map((n) => ({ value: n, label: n })),
        ...(audioDevice && audioDevice !== "@auto" && !names.includes(audioDevice) ? [{ value: audioDevice, label: `${audioDevice} (non connectée)` }] : []),
      ]} />
    </Row>
  );
}

function OptionControl({ w, o }: { w: WidgetInstance; o: OptionDef }) {
  if (o.kind === "audio-device") return <AudioOutputControl o={o} />;
  const val = resolveOpts(w)[o.key];
  const set = (v: unknown) => updateWidget(w.id, (x) => ({ ...x, opts: { ...x.opts, [o.key]: v } }));
  return (
    <Row label={o.label} hint={o.hint} stack={o.kind === "text"}>
      {o.kind === "toggle" && <Toggle label={o.label} value={val !== false && !!val} onChange={set} />}
      {o.kind === "select" && <Select label={o.label} value={String(val)} options={o.choices ?? []} onChange={set} />}
      {o.kind === "text" && <TextInput label={o.label} value={typeof val === "string" ? val : ""} placeholder={o.placeholder} onChange={set} width="100%" />}
    </Row>
  );
}

export default function WidgetsPage({ focusId }: { focusId: string | null }) {
  const widgets = useSettings((x) => x.widgets);
  const dsk = useSettings((x) => x.desktop);
  const s = { widgets };
  const setDsk = (p: Partial<Settings["desktop"]>) => updateSettings((x) => ({ ...x, desktop: { ...x.desktop, ...p } }));
  const [open, setOpen] = useState<string | null>(focusId);
  useEffect(() => { if (focusId) setOpen(focusId); }, [focusId]);

  const add = (t: (typeof WIDGET_ORDER)[number]) => {
    const w = makeWidget(t, s.widgets);
    updateSettings((x) => ({ ...x, widgets: [...x.widgets, w] }));
    setOpen(w.id);
  };
  const remove = (id: string) => updateSettings((x) => ({ ...x, widgets: x.widgets.filter((w) => w.id !== id) }));
  const duplicate = (w: WidgetInstance) => {
    const c: WidgetInstance = { ...w, id: newId(), x: w.x + 28, y: w.y + 28, opts: { ...w.opts } };
    updateSettings((x) => ({ ...x, widgets: [...x.widgets, c] }));
    setOpen(c.id);
  };
  const edit = () => { send("halo-edit-widgets", true); call("hide_settings"); };

  return (
    <>
      <PageHeader title="Widgets" desc="Ce qui se pose sur le bureau : horloge, calendrier, musique, notes…" onReset={() => resetKeys(RESET_GROUPS.widgets.keys)} resetLabel="Rétablir les widgets" />

      <Section title="Bureau" desc="Réglages communs à tous les widgets.">
        <Row label="Afficher les widgets" hint="Désactivé : le bureau n'affiche que le fond d'écran (les widgets sont conservés)."><Toggle label="Afficher les widgets" value={dsk.widgets} onChange={(v) => setDsk({ widgets: v })} /></Row>
        <Row label="Widgets sur tous les écrans" off={!dsk.widgets} hint="Répète les widgets sur chaque écran. Désactivé : ils restent sur l'écran principal."><Toggle label="Widgets sur tous les écrans" value={dsk.allScreens} onChange={(v) => setDsk({ allScreens: v })} /></Row>
        <Row label="Grille magnétique" hint="Pendant le déplacement d'un widget, sa position se cale sur une grille.">
          <Select<string> label="Grille magnétique" value={String(dsk.snap)} onChange={(v) => setDsk({ snap: Number(v) })} options={[
            { value: "0", label: "Aucune" }, { value: "8", label: "8 px" }, { value: "16", label: "16 px" }, { value: "24", label: "24 px" }, { value: "32", label: "32 px" }, { value: "48", label: "48 px" }]} />
        </Row>
        <Row label="Opacité des widgets" hint="Rend tous les widgets plus discrets sur le bureau." off={!dsk.widgets}>
          <Slider label="Opacité des widgets" def={Math.round(DEFAULTS.desktop.opacity * 100)} value={Math.round(dsk.opacity * 100)} min={20} max={100} step={5} onChange={(v) => setDsk({ opacity: v / 100 })} format={(v) => v + " %"} />
        </Row>
        <Row label="Menu du clic droit sur le bureau" hint="Modifier les widgets, changer le fond d'écran, ouvrir les réglages."><Toggle label="Menu du clic droit" value={dsk.menu} onChange={(v) => setDsk({ menu: v })} /></Row>
        <Row label="Placer les widgets"><Btn variant="accent" onClick={edit}><LayoutGrid size={14} />Placer sur le bureau</Btn></Row>
      </Section>

      <Section title="Ajouter un widget" desc="Les widgets se posent sur le bureau. Déplace-les ensuite avec « Placer sur le bureau ».">
        <div className="grid gap-px sm:grid-cols-2" style={{ background: "var(--stroke)" }}>
          {WIDGET_ORDER.map((t) => {
            const m = WIDGETS[t], I = m.icon;
            return (
              <button key={t} type="button" onClick={() => add(t)} aria-label={`Ajouter ${m.name}`}
                className="flex items-start gap-3 p-3.5 text-left transition-colors hover:brightness-125" style={{ background: "var(--surface-2)" }}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: t.startsWith("spotify") ? "#1db954" : "var(--surface-3)", color: t.startsWith("spotify") ? "#000" : "var(--text)" }}><I size={18} /></span>
                <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold">{m.name}</span><span className="block text-[11px] leading-snug mono-dim">{m.desc}</span></span>
                <Plus size={16} className="mt-1 shrink-0 mono-dim" />
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Sur le bureau" desc="Clique sur un widget pour régler sa taille et ses options.">
        {s.widgets.length === 0 && <p className="p-4 text-xs mono-dim">Aucun widget. Ajoutes-en un ci-dessus.</p>}
        {s.widgets.map((w) => {
          const m = WIDGETS[w.type], I = m.icon, isOpen = open === w.id;
          return (
            <div key={w.id} className="border-b last:border-b-0" style={{ borderColor: "var(--stroke)" }}>
              <div className="flex items-center gap-3 px-4 py-2.5">
                <button type="button" onClick={() => setOpen(isOpen ? null : w.id)} aria-expanded={isOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  {isOpen ? <ChevronDown size={15} className="mono-dim" /> : <ChevronRight size={15} className="mono-dim" />}
                  <I size={17} /><span className="truncate text-[13px] font-medium" style={{ opacity: w.visible ? 1 : 0.5 }}>{m.name}</span>
                </button>
                <button type="button" aria-label={w.visible ? "Masquer" : "Afficher"} title={w.visible ? "Masquer" : "Afficher"} onClick={() => updateWidget(w.id, (x) => ({ ...x, visible: !x.visible }))}
                  className="rounded-lg p-2 transition-colors hover:bg-white/10">{w.visible ? <Eye size={16} /> : <EyeOff size={16} />}</button>
                <Btn label={`Supprimer ${m.name}`} variant="danger" onClick={() => remove(w.id)}><Trash2 size={14} /></Btn>
              </div>
              {isOpen && (
                <div className="border-t" style={{ borderColor: "var(--stroke)", background: "var(--surface)" }}>
                  <Row label="Taille"><Slider label="Taille du widget" def={100} value={Math.round(w.scale * 100)} min={50} max={250} step={5} onChange={(v) => updateWidget(w.id, (x) => ({ ...x, scale: v / 100 }))} format={(v) => v + " %"} /></Row>
                  {m.options.map((o) => <OptionControl key={o.key} w={w} o={o} />)}
                  <Row label="Position" hint="Se règle en glissant le widget sur le bureau.">
                    <div className="flex gap-2">
                    <Btn onClick={() => duplicate(w)}><Copy size={13} />Dupliquer</Btn>
                    <Btn onClick={() => { const d = makeWidget(w.type, []); updateWidget(w.id, (x) => ({ ...x, ax: d.ax, ay: d.ay, x: d.x, y: d.y })); }}><RotateCcw size={13} />Position d'origine</Btn>
                    </div>
                  </Row>
                </div>
              )}
            </div>
          );
        })}
        <div className="flex justify-end px-4 py-2.5">
          <Btn onClick={() => updateSettings((x) => ({ ...x, widgets: DEFAULT_WIDGETS }))}><RotateCcw size={13} />Rétablir la disposition par défaut</Btn>
        </div>
      </Section>
    </>
  );
}
