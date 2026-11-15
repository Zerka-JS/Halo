import { useState } from "react";
import { Trash2 } from "lucide-react";
import { DEFAULTS, RESET_GROUPS, resetKeys, SEARCH_ENGINES, updateSettings, useSettings, webSearchUrl, type SearchCfg, type SearchEngine } from "../../lib/settings";
import { clearUsage } from "../../lib/search";
import { Btn, PageHeader, Row, Section, Select, Slider, TextInput, Toggle } from "../../components/ui";

type BoolKey = { [K in keyof SearchCfg]: SearchCfg[K] extends boolean ? K : never }[keyof SearchCfg];

const ENGINES: { value: SearchEngine; label: string }[] = [
  ...(Object.entries(SEARCH_ENGINES) as [Exclude<SearchEngine, "custom">, { name: string }][]).map(([value, e]) => ({ value: value as SearchEngine, label: e.name })),
  { value: "custom", label: "Personnalisé…" },
];

export default function SearchPage() {
  const c = useSettings((s) => s.search);
  const [cleared, setCleared] = useState(false);
  const set = (p: Partial<SearchCfg>) => updateSettings((s) => ({ ...s, search: { ...s.search, ...p } }));
  const flag = (k: BoolKey, label: string, hint: string, off?: boolean) => (
    <Row label={label} hint={hint} off={off}>
      <Toggle label={label} value={c[k]} onChange={(v) => updateSettings((s) => ({ ...s, search: { ...s.search, [k]: v } }))} />
    </Row>
  );
  const customOk = c.engine !== "custom" || /^https?:\/\/\S+$/i.test(c.custom.trim());

  return (
    <>
      <PageHeader title="Recherche" desc="La recherche d'applications : moteur web, ce qu'elle propose et ce qu'elle retient."
        onReset={() => resetKeys(RESET_GROUPS.search.keys)} />

      <Section title="Moteur de recherche web" desc="Utilisé quand tu choisis « Rechercher sur le web » dans la recherche.">
        <Row label="Moteur">
          <Select<SearchEngine> label="Moteur de recherche" value={c.engine} onChange={(v) => set({ engine: v })} options={ENGINES} />
        </Row>
        <Row label="Adresse du moteur personnalisé" off={c.engine !== "custom"}
          hint={customOk ? `Exemple : https://exemple.org/?q=%s — « %s » est remplacé par ce que tu tapes. Test : ${webSearchUrl(c, "halo")}` : "L'adresse doit commencer par http:// ou https://. En attendant, Google est utilisé."}>
          <TextInput label="Adresse du moteur personnalisé" width={300} value={c.custom} placeholder="https://exemple.org/search?q=%s" onChange={(v) => set({ custom: v })} />
        </Row>
      </Section>

      <Section title="Ce que la recherche propose">
        {flag("web", "Rechercher sur le web", "Dernier résultat de la liste : lance la recherche dans ton navigateur.")}
        {flag("urls", "Ouvrir les liens", "Un lien tapé (exemple.fr, https://…) s'ouvre directement.")}
        {flag("halo", "Raccourcis vers les réglages de Halo", "Taper « dock », « fond » ou « animations » ouvre la page de réglages correspondante.")}
        {flag("calc", "Calculatrice", "Tape une opération (12*3,5 ; (2+3)^2 ; sqrt(81) ; 20%) : le résultat s'affiche et Entrée le copie.")}
        {flag("system", "Commandes système", "Verrouiller, veille, redémarrer, arrêter, basculer le thème… (arrêt et redémarrage demandent confirmation).")}
      </Section>

      <Section title="Liste des résultats">
        <Row label="Applications affichées avant de taper" hint="Nombre d'applications proposées quand le champ est vide (les plus lancées, ou les premières). 0 = liste vide.">
          <Slider label="Applications affichées avant de taper" def={DEFAULTS.search.recents} value={c.recents} min={0} max={12} onChange={(v) => set({ recents: v })} />
        </Row>
        <Row label="Résultats au maximum" hint="Nombre maximal de résultats pendant la frappe.">
          <Slider label="Résultats au maximum" def={DEFAULTS.search.max} value={c.max} min={4} max={16} onChange={(v) => set({ max: v })} />
        </Row>
        {flag("remember", "Retenir les applications les plus lancées", "Elles remontent dans la liste et s'affichent en premier quand le champ est vide.")}
        <Row label="Effacer l'historique" hint="Oublie les applications les plus lancées.">
          <Btn onClick={() => { clearUsage(); setCleared(true); window.setTimeout(() => setCleared(false), 2200); }}><Trash2 size={13} />{cleared ? "Historique effacé" : "Effacer"}</Btn>
        </Row>
      </Section>
    </>
  );
}
