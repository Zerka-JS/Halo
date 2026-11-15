import { DEFAULTS, RESET_GROUPS, resetKeys, updateSettings, useSettings, type ShortcutsCfg } from "../../lib/settings";
import { duplicateShortcuts, SHORTCUTS, useShortcutStatus } from "../../lib/shortcuts";
import { Kbd, Notice, PageHeader, Row, Section, ShortcutInput } from "../../components/ui";

const GROUPS: { title: string; desc?: string; keys: (keyof ShortcutsCfg)[] }[] = [
  { title: "Applications", desc: "Ouvrent une fenêtre de Halo depuis n'importe où dans Windows.", keys: ["search", "settings", "widgets"] },
  { title: "Fond d'écran", keys: ["nextWallpaper", "prevWallpaper"] },
  { title: "Système", keys: ["theme", "mute"] },
];

/** Raccourcis qui ne se changent pas : actifs seulement quand la fenêtre concernée est au premier plan */
const FIXED: { title: string; rows: [string[], string][] }[] = [
  { title: "Dans les réglages", rows: [
    [["Ctrl", "K"], "Rechercher un réglage"], [["Ctrl", "Page ↑ / ↓"], "Page précédente / suivante"], [["Échap"], "Fermer les réglages"]] },
  { title: "Dans la recherche d'applications", rows: [
    [["↑", "↓"], "Choisir un résultat"], [["Entrée"], "Ouvrir le résultat"], [["Échap"], "Fermer la recherche"]] },
  { title: "Choix du fond d'écran", rows: [
    [["←", "→"], "Fond précédent / suivant"], [["Entrée"], "Appliquer le fond affiché"]] },
  { title: "Bureau", rows: [[["Échap"], "Quitter le mode édition des widgets"]] },
];

export default function ShortcutsPage() {
  const sc = useSettings((s) => s.shortcuts);
  const status = useShortcutStatus();
  const dup = duplicateShortcuts(sc);
  const set = (k: keyof ShortcutsCfg, v: string) => updateSettings((s) => ({ ...s, shortcuts: { ...s.shortcuts, [k]: v } }));

  return (
    <>
      <PageHeader title="Raccourcis" desc="Raccourcis clavier globaux : ils fonctionnent partout dans Windows, même quand Halo n'est pas au premier plan."
        onReset={() => resetKeys(RESET_GROUPS.shortcuts.keys)} />
      <Notice>
        Clique sur un champ, puis appuie sur la combinaison voulue (avec Ctrl, Alt ou Maj ; une touche F1 à F24 peut être seule).
        <b> Échap</b> annule, <b>Retour arrière</b> désactive le raccourci. Une combinaison déjà prise par Windows ou par une autre application ne peut pas être enregistrée.
      </Notice>
      {dup.size > 0 && (
        <Notice tone="warn">
          La combinaison {[...dup].join(", ")} est utilisée par plusieurs actions : seule la première sera active. Change-en une.
        </Notice>
      )}

      {GROUPS.map((g) => (
        <Section key={g.title} title={g.title} desc={g.desc}>
          {g.keys.map((k) => {
            const d = SHORTCUTS.find((x) => x.key === k)!;
            const failed = !!sc[k] && status?.[k] === "fail" && !dup.has(sc[k]);
            return (
              <Row key={k} label={d.label} hint={failed ? `${d.hint} Indisponible : cette combinaison est déjà prise par Windows ou par une autre application.` : d.hint}>
                <ShortcutInput label={d.label} value={sc[k]} def={DEFAULTS.shortcuts[k]} onChange={(v) => set(k, v)} />
              </Row>
            );
          })}
        </Section>
      ))}

      <Section title="Touches dans les fenêtres de Halo" desc="Fixes : actives quand la fenêtre est au premier plan.">
        {FIXED.map((g) => (
          <div key={g.title} className="border-b px-4 py-3 last:border-b-0" style={{ borderColor: "var(--stroke)" }}>
            <div className="mb-2 text-[13px] font-medium">{g.title}</div>
            <div className="grid gap-1.5">
              {g.rows.map(([keys, what]) => (
                <div key={what} className="flex items-center justify-between gap-3 text-xs">
                  <span className="mono-dim">{what}</span>
                  <span className="flex gap-1">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Section>
    </>
  );
}
