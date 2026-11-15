import { useState } from "react";
import { AppWindow, ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from "lucide-react";
import { DEFAULT_PINS, DEFAULTS, newId, RESET_GROUPS, resetKeys, updateSettings, useSettings, type DockSpring, type IndicatorStyle, type PanelBg, type Pin } from "../../lib/settings";
import { PICKABLE_ICONS, PIN_ICONS } from "../../lib/icons";
import { useRunningApps } from "../../hooks/useRunningApps";
import { Btn, PageHeader, Row, Section, Segmented, Slider, TextInput, Toggle } from "../../components/ui";

function PinGlyph({ p, size = 22 }: { p: Pin; size?: number }) {
  const I = PIN_ICONS[p.iconKey ?? ""] ?? AppWindow;
  return p.img ? <img src={p.img} alt="" draggable={false} style={{ width: size, height: size }} /> : <I size={size} strokeWidth={1.6} />;
}

/** Nom de processus probable d'après une cible (chemin ou commande) pour détecter l'app ouverte */
function exeFromTarget(t: string): string[] {
  if (/^[a-z][a-z0-9+.-]+:/i.test(t) && !/^[a-z]:[\\/]/i.test(t)) return [];
  const base = t.split(/[\\/]/).pop() ?? "";
  const n = base.replace(/\.(exe|lnk|bat|cmd)$/i, "").toLowerCase();
  return n ? [n] : [];
}

export default function DockPage({ active }: { active: boolean }) {
  const pins = useSettings((x) => x.pins);
  const d = useSettings((x) => x.dock);
  const searchKey = useSettings((x) => x.shortcuts.search);
  const s = { pins };
  const { apps, icons } = useRunningApps(active ? 2500 : 60_000);
  const [name, setName] = useState(""), [target, setTarget] = useState(""), [iconKey, setIconKey] = useState("app");

  const setDock = (p: Partial<typeof d>) => updateSettings((x) => ({ ...x, dock: { ...x.dock, ...p } }));
  const setPins = (fn: (p: Pin[]) => Pin[]) => updateSettings((x) => ({ ...x, pins: fn(x.pins) }));
  const move = (i: number, dir: -1 | 1) => setPins((p) => {
    const j = i + dir;
    if (j < 0 || j >= p.length) return p;
    const n = [...p]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });
  const rename = (id: string, label: string) => setPins((p) => p.map((x) => (x.id === id ? { ...x, label } : x)));

  const pinned = new Set(s.pins.flatMap((p) => p.exe));
  const candidates = apps.filter((a, i) => a.path && !pinned.has(a.name.toLowerCase()) && apps.findIndex((b) => b.name === a.name) === i);

  const pinApp = (a: (typeof apps)[number]) => {
    const n = a.name.toLowerCase();
    setPins((p) => [...p, { id: "p-" + n + "-" + newId(""), label: a.name.charAt(0).toUpperCase() + a.name.slice(1), exe: [n], target: a.path, img: icons[a.path] }]);
  };
  const addCustom = () => {
    const t = target.trim();
    if (!t) return;
    setPins((p) => [...p, { id: newId("c-"), label: name.trim() || t.split(/[\\/]/).pop() || "App", exe: exeFromTarget(t), target: t, iconKey }]);
    setName(""); setTarget(""); setIconKey("app");
  };

  return (
    <>
      <PageHeader title="Dock" desc="Astuce : tu peux aussi faire glisser les icônes directement dans le dock pour les réordonner."
        onReset={() => resetKeys(RESET_GROUPS.dock.keys)} />

      <Section title="Ordre des icônes" desc="De gauche à droite dans le dock. Les applications ouvertes mais non épinglées s'ajoutent ensuite.">
        {s.pins.length === 0 && <p className="p-4 text-xs mono-dim">Aucune icône épinglée.</p>}
        {s.pins.map((p, i) => (
          <div key={p.id} className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0" style={{ borderColor: "var(--stroke)" }}>
            <span className="w-5 text-center text-[11px] tabular-nums mono-dim">{i + 1}</span>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[22%]" style={{ background: "var(--surface-3)" }}><PinGlyph p={p} /></span>
            <div className="min-w-0 flex-1">
              <TextInput label={`Nom de ${p.label}`} value={p.label} onChange={(v) => rename(p.id, v)} width="100%" />
              <div className="mt-1 truncate text-[10px] mono-dim" title={p.target}>{p.target}</div>
            </div>
            <Btn label={`Monter ${p.label}`} onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp size={14} /></Btn>
            <Btn label={`Descendre ${p.label}`} onClick={() => move(i, 1)} disabled={i === s.pins.length - 1}><ArrowDown size={14} /></Btn>
            <Btn label={`Retirer ${p.label}`} variant="danger" onClick={() => setPins((x) => x.filter((y) => y.id !== p.id))}><Trash2 size={14} /></Btn>
          </div>
        ))}
        <div className="flex justify-end px-4 py-2.5">
          <Btn onClick={() => setPins(() => DEFAULT_PINS)}><RotateCcw size={13} />Rétablir les icônes par défaut</Btn>
        </div>
      </Section>

      <Section title="Ajouter une application">
        {candidates.length > 0 && (
          <div className="border-b px-4 py-3" style={{ borderColor: "var(--stroke)" }}>
            <div className="mb-2 text-[13px] font-medium">Applications ouvertes</div>
            <div className="flex flex-wrap gap-2">
              {candidates.map((a) => (
                <button key={a.pid} type="button" onClick={() => pinApp(a)} title={a.title}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors hover:opacity-80" style={{ background: "var(--surface-3)" }}>
                  {icons[a.path] ? <img src={icons[a.path]} alt="" className="h-5 w-5" /> : <AppWindow size={16} />}{a.name}<Plus size={12} />
                </button>
              ))}
            </div>
          </div>
        )}
        <Row label="Nom" stack><TextInput label="Nom" value={name} onChange={setName} placeholder="Ex. Notepad" width="100%" /></Row>
        <Row label="Programme, dossier ou lien" hint="Chemin d'un .exe, commande (notepad), dossier, lien web (https://…) ou protocole (spotify:)." stack>
          <TextInput label="Cible" value={target} onChange={setTarget} placeholder="C:\Program Files\…\app.exe" width="100%" />
        </Row>
        <Row label="Icône" stack>
          <div className="flex flex-wrap gap-1.5">
            {PICKABLE_ICONS.map((k) => {
              const I = PIN_ICONS[k];
              return (
                <button key={k} type="button" aria-label={`Icône ${k}`} aria-pressed={iconKey === k} onClick={() => setIconKey(k)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
                  style={iconKey === k ? { background: "var(--accent)", color: "var(--accent-fg)" } : { background: "var(--surface-3)" }}><I size={18} strokeWidth={1.6} /></button>
              );
            })}
          </div>
        </Row>
        <div className="flex justify-end px-4 py-3"><Btn variant="accent" onClick={addCustom} disabled={!target.trim()}><Plus size={14} />Ajouter au dock</Btn></div>
      </Section>

      <Section title="Taille et comportement">
        <Row label="Taille des icônes"><Slider label="Taille des icônes" def={DEFAULTS.dock.size} value={d.size} min={32} max={80} onChange={(v) => setDock({ size: v })} format={(v) => v + " px"} /></Row>
        <Row label="Espacement des icônes" hint="Distance entre deux icônes."><Slider label="Espacement des icônes" def={DEFAULTS.dock.gap} value={d.gap} min={2} max={28} onChange={(v) => setDock({ gap: v })} format={(v) => v + " px"} /></Row>
        <Row label="Effet de loupe" hint="Les icônes grossissent sous le curseur."><Toggle label="Effet de loupe" value={d.magnify} onChange={(v) => setDock({ magnify: v })} /></Row>
        {d.magnify && <>
          <Row label="Force de la loupe"><Slider label="Force de la loupe" def={Math.round(DEFAULTS.dock.zoom * 100)} value={Math.round(d.zoom * 100)} min={110} max={220} step={5} onChange={(v) => setDock({ zoom: v / 100 })} format={(v) => "×" + (v / 100).toFixed(2)} /></Row>
          <Row label="Portée de la loupe" hint="Nombre d'icônes voisines qui grossissent avec celle sous la souris."><Slider label="Portée de la loupe" def={DEFAULTS.dock.range} value={d.range} min={60} max={300} step={10} onChange={(v) => setDock({ range: v })} format={(v) => v + " px"} /></Row>
          <Row label="Souplesse de la loupe" hint="Doux : l'icône suit la souris avec un léger retard élastique. Vif : réaction immédiate.">
            <Segmented<DockSpring> label="Souplesse de la loupe" value={d.spring} onChange={(v) => setDock({ spring: v })} options={[
              { value: "soft", label: "Doux" }, { value: "normal", label: "Normal" }, { value: "snappy", label: "Vif" }]} />
          </Row>
        </>}
        <Row label="Rebond au lancement" hint="L'icône rebondit pendant que l'application démarre."><Toggle label="Rebond au lancement" value={d.bounce} onChange={(v) => setDock({ bounce: v })} /></Row>
        <Row label="Infobulles au survol"><Toggle label="Infobulles" value={d.labels} onChange={(v) => setDock({ labels: v })} /></Row>
        {d.labels && <Row label="Délai des infobulles" hint="Attente avant l'affichage du nom de l'application."><Slider label="Délai des infobulles" def={DEFAULTS.dock.tipDelay} value={d.tipDelay} min={0} max={1500} step={50} onChange={(v) => setDock({ tipDelay: v })} format={(v) => v + " ms"} /></Row>}
      </Section>

      <Section title="Applications ouvertes" desc="Comment le dock montre ce qui tourne en ce moment.">
        <Row label="Afficher les applications ouvertes non épinglées" hint="Désactivé : le dock ne montre que tes icônes épinglées (les applications épinglées ouvertes gardent leur indicateur)."><Toggle label="Applications ouvertes non épinglées" value={d.showRunning} onChange={(v) => setDock({ showRunning: v })} /></Row>
        <Row label="Indicateur sous les applications ouvertes"><Toggle label="Indicateurs" value={d.indicators} onChange={(v) => setDock({ indicators: v })} /></Row>
        <Row label="Style de l'indicateur" off={!d.indicators}>
          <Segmented<IndicatorStyle> label="Style de l'indicateur" value={d.indicator} onChange={(v) => setDock({ indicator: v })} options={[
            { value: "dot", label: "Point" }, { value: "bar", label: "Trait" }, { value: "glow", label: "Halo" }]} />
        </Row>
        <Row label="Séparateur" hint="Fine ligne entre les applications et les icônes fixes (recherche, réglages, téléchargements, corbeille)."><Toggle label="Séparateur" value={d.separator} onChange={(v) => setDock({ separator: v })} /></Row>
        <Row label="Réorganiser par glisser-déposer" hint="Faire glisser une icône épinglée dans le dock pour la déplacer."><Toggle label="Réorganiser par glisser-déposer" value={d.reorder} onChange={(v) => setDock({ reorder: v })} /></Row>
      </Section>

      <Section title="Forme" desc="Fond, arrondis du dock et de ses icônes.">
        <Row label="Fond du dock" hint="Transparent : seules les icônes flottent au-dessus du bureau." stack>
          <Segmented<PanelBg> label="Fond du dock" value={d.bg} onChange={(v) => setDock({ bg: v })} options={[
            { value: "glass", label: "Verre" }, { value: "solid", label: "Opaque" }, { value: "none", label: "Transparent" }]} />
        </Row>
        <Row label="Arrondi des icônes" hint="8 % = presque carré · 50 % = rond."><Slider label="Arrondi des icônes" def={DEFAULTS.dock.iconRadius} value={d.iconRadius} min={8} max={50} onChange={(v) => setDock({ iconRadius: v })} format={(v) => v + " %"} /></Row>
        <Row label="Arrondi de la barre du dock"><Slider label="Arrondi de la barre du dock" def={DEFAULTS.dock.barRadius} value={d.barRadius} min={6} max={40} onChange={(v) => setDock({ barRadius: v })} format={(v) => v + " px"} /></Row>
      </Section>

      <Section title="Icônes fixes (à droite)">
        <Row label="Recherche (loupe)" hint={"Trouve et lance n'importe quelle application sans la touche Windows. Raccourci : " + (searchKey ? searchKey.replace("Space", "Espace").replace(/\+/g, " + ") : "aucun (Réglages › Raccourcis)") + "."}><Toggle label="Recherche" value={d.search} onChange={(v) => setDock({ search: v })} /></Row>
        <Row label="Réglages de Halo"><Toggle label="Réglages de Halo" value={d.settings} onChange={(v) => setDock({ settings: v })} /></Row>
        <Row label="Téléchargements"><Toggle label="Téléchargements" value={d.downloads} onChange={(v) => setDock({ downloads: v })} /></Row>
        <Row label="Fichiers listés dans Téléchargements" off={!d.downloads} hint="Nombre de fichiers récents affichés dans la pile du dock."><Slider label="Fichiers listés dans Téléchargements" def={DEFAULTS.dock.dlCount} value={d.dlCount} min={3} max={12} onChange={(v) => setDock({ dlCount: v })} /></Row>
        <Row label="Corbeille"><Toggle label="Corbeille" value={d.trash} onChange={(v) => setDock({ trash: v })} /></Row>
      </Section>
    </>
  );
}
