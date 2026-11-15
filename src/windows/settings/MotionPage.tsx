import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { DEFAULTS, RESET_GROUPS, resetKeys, updateSettings, useSettings, type AutoEco, type MotionLevel, type PerfMode } from "../../lib/settings";
import { usePerf } from "../../lib/theme";
import { Btn, PageHeader, Row, Section, Segmented, Slider, Toggle } from "../../components/ui";

const PERF_HINT: Record<PerfMode, string> = {
  quality: "Tout est affiché au maximum : flou, fusion de calques, animations du fond à pleine cadence.",
  balanced: "Réglage conseillé : les réglages que tu as choisis sont appliqués tels quels.",
  economy: "Flou du verre plafonné à 10 px, sans saturation, fusion de calques désactivée et fond animé limité à 15 images/s. Idéal sur batterie ou PC modeste.",
};
const LEVEL_HINT: Record<MotionLevel, string> = {
  full: "Ressorts, rebonds, fondus et fonds animés.",
  reduced: "Mouvements courts et sans rebond ; les fonds animés (aurore, vidéo, constellations) sont figés.",
  off: "Aucune animation : tout apparaît instantanément. Les fonds animés sont figés.",
};
const ECO_HINT: Record<AutoEco, string> = {
  off: "Le mode choisi ci-dessus reste appliqué en toutes circonstances.",
  battery: "Dès que le PC fonctionne sur batterie (non branché), Halo passe en mode économie ; il revient au mode choisi une fois branché.",
  low: "Halo passe en mode économie quand la batterie descend à 20 % ou moins (et n'est pas en charge).",
};

/** Mesure la cadence réelle d'affichage de cette fenêtre pendant 2 secondes */
function useFpsTest() {
  const [res, setRes] = useState<{ fps: number; worst: number } | null>(null);
  const [running, setRunning] = useState(false);
  const raf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const start = () => {
    setRunning(true); setRes(null);
    let prev = 0, n = 0, worst = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      if (prev) { n++; worst = Math.max(worst, now - prev); }
      prev = now;
      if (now - t0 < 2000) raf.current = requestAnimationFrame(tick);
      else { setRes({ fps: Math.round((n * 1000) / (now - t0)), worst: Math.round(worst) }); setRunning(false); }
    };
    raf.current = requestAnimationFrame(tick);
  };
  return { res, running, start };
}

export default function MotionPage() {
  const s = useSettings();
  const m = s.motion, r = s.refresh;
  const [demo, setDemo] = useState(0);
  const fps = useFpsTest();
  const eff = usePerf();
  const setM = (p: Partial<typeof m>) => updateSettings((x) => ({ ...x, motion: { ...x.motion, ...p } }));
  const setR = (p: Partial<typeof r>) => updateSettings((x) => ({ ...x, refresh: { ...x.refresh, ...p } }));

  return (
    <>
      <PageHeader title="Animations et fluidité" desc="Un seul endroit pour régler la douceur des mouvements, la charge sur ton PC et la fréquence des mises à jour."
        onReset={() => resetKeys(RESET_GROUPS.motion.keys)} />

      <Section title="Animations" desc="S'applique à Halo entier : dock, menus, réglages, widgets et fond d'écran.">
        <Row label="Niveau" hint={LEVEL_HINT[m.level]} stack>
          <Segmented<MotionLevel> label="Niveau d'animation" value={m.level} onChange={(v) => setM({ level: v })} options={[
            { value: "full", label: "Complètes" }, { value: "reduced", label: "Réduites" }, { value: "off", label: "Aucune" }]} />
        </Row>
        {m.level !== "off" && (
          <Row label="Vitesse" hint="Plus haut = animations plus rapides et plus nerveuses ; plus bas = plus lentes et plus douces.">
            <Slider label="Vitesse des animations" def={DEFAULTS.motion.speed * 100} value={Math.round(m.speed * 100)} min={50} max={200} step={5} onChange={(v) => setM({ speed: v / 100 })} format={(v) => v + " %"} />
          </Row>
        )}
        <Row label="Transition entre deux fonds d'écran" hint="Joue l'effet choisi dans Fond d'écran (Cercle, Balayage, Points, Fondu) au lieu de remplacer l'ancien fond d'un coup.">
          <Toggle label="Transition entre deux fonds d'écran" value={m.fade} onChange={(v) => setM({ fade: v })} />
        </Row>
        <Row label="Tester" hint="Rejoue l'animation d'apparition avec les réglages actuels.">
          <div className="flex items-center gap-3">
            <div key={demo} className="halo-pop glass flex h-9 w-9 items-center justify-center rounded-[var(--radius)]" aria-hidden><Sparkles size={16} style={{ color: "var(--accent)" }} /></div>
            <Btn onClick={() => setDemo((d) => d + 1)}>Rejouer</Btn>
          </div>
        </Row>
      </Section>

      <Section title="Performances" desc="Pour un PC modeste, un portable sur batterie, ou si Halo ralentit un jeu.">
        <Row label="Mode" hint={PERF_HINT[m.perf]} stack>
          <Segmented<PerfMode> label="Mode de performance" value={m.perf} onChange={(v) => setM({ perf: v })} options={[
            { value: "quality", label: "Qualité" }, { value: "balanced", label: "Équilibré" }, { value: "economy", label: "Économie" }]} />
        </Row>
        <Row label="Économie d'énergie automatique" hint={ECO_HINT[m.autoEco] + (m.autoEco !== "off" && eff === "economy" && m.perf !== "economy" ? " · En ce moment : économie activée." : "")} stack>
          <Segmented<AutoEco> label="Économie d'énergie automatique" value={m.autoEco} onChange={(v) => setM({ autoEco: v })} options={[
            { value: "off", label: "Jamais" }, { value: "battery", label: "Sur batterie" }, { value: "low", label: "Batterie faible" }]} />
        </Row>
        <Row label="Mesurer la fluidité" hint={fps.res ? `${fps.res.fps} images/s en moyenne · image la plus lente : ${fps.res.worst} ms. ${fps.res.fps >= 55 ? "Rendu fluide." : fps.res.fps >= 40 ? "Correct : essaie le mode Équilibré ou Économie si le dock saccade." : "Saccades : passe en mode Économie et réduis le flou."}` : "Mesure pendant 2 secondes la cadence d'affichage réelle de cette fenêtre."}>
          <Btn onClick={fps.start} disabled={fps.running}>{fps.running ? "Mesure…" : "Lancer la mesure"}</Btn>
        </Row>
      </Section>

      <Section title="Fréquence d'actualisation" desc="Plus c'est rare, moins Halo consomme ; plus c'est fréquent, plus le dock et la barre réagissent vite.">
        <Row label="Applications ouvertes (dock)" hint="Délai pour voir apparaître ou disparaître une application dans le dock.">
          <Slider label="Actualisation des applications" def={DEFAULTS.refresh.apps} value={r.apps} min={1} max={15} step={0.5} onChange={(v) => setR({ apps: v })} format={(v) => v + " s"} />
        </Row>
        <Row label="Réseau et batterie (barre du haut)">
          <Slider label="Actualisation réseau et batterie" def={DEFAULTS.refresh.status} value={r.status} min={5} max={120} step={5} onChange={(v) => setR({ status: v })} format={(v) => v + " s"} />
        </Row>
      </Section>
    </>
  );
}
