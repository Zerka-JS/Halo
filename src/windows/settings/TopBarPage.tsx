import { Battery, ChevronUp, Hexagon, Power, Search, SlidersHorizontal, Volume2, Wifi } from "lucide-react";
import { DEFAULTS, RESET_GROUPS, resetKeys, updateSettings, useSettings, type DateStyle, type PanelBg, type Settings, type TopBarCfg } from "../../lib/settings";
import { fmtDate, fmtTime, LOCALES, useNow } from "../../lib/clock";
import { panelStyle } from "../../lib/panel";
import { useActive } from "../../lib/active";
import { PageHeader, Row, Section, Segmented, Select, Slider, Toggle } from "../../components/ui";

type BoolKey = { [K in keyof TopBarCfg]: TopBarCfg[K] extends boolean ? K : never }[keyof TopBarCfg];

/** Réplique fidèle de la barre : suit les réglages en direct */
function BarPreview() {
  const t = useSettings((s) => s.topbar);
  const c = useSettings((s) => s.clock);
  const active = useActive();
  const now = useNow(c.seconds, active);
  const ico = Math.round(t.size * 1.15);
  const date = c.date ? fmtDate(now, c) : "";
  return (
    <div className="relative mb-6 overflow-hidden rounded-2xl border" aria-hidden
      style={{ borderColor: "var(--stroke-strong)", background: "linear-gradient(120deg,#3b2a5c,#e5484d 55%,#f5b400)" }}>
      <div className="h-20">
        <div className="glass flex h-8 w-full items-center justify-between rounded-none border-x-0 border-t-0 px-3" style={{ fontSize: t.size, ...panelStyle(t.bg) }}>
          <span className="flex items-center gap-2 font-semibold"><Hexagon size={ico} strokeWidth={2.2} />{t.label && "Halo"}</span>
          <span className="flex items-center" style={{ gap: t.gap }}>
            {t.search && <Search size={ico} />}
            {t.background && <ChevronUp size={ico} />}
            {t.network && <Wifi size={ico} />}
            {t.volume && <Volume2 size={ico} />}
            {t.battery && <span className="flex items-center gap-1 tabular-nums"><Battery size={ico + 2} />{t.batteryPercent && "82%"}</span>}
            {t.control && <SlidersHorizontal size={ico} />}
            {t.clock && <span className="font-medium tabular-nums">{date ? date + " " : ""}{fmtTime(now, c)}</span>}
            {t.power && <Power size={ico} />}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function TopBarPage() {
  const t = useSettings((s) => s.topbar);
  const c = useSettings((s) => s.clock);
  const setTb = (p: Partial<TopBarCfg>) => updateSettings((s) => ({ ...s, topbar: { ...s.topbar, ...p } }));
  const setClock = (p: Partial<Settings["clock"]>) => updateSettings((s) => ({ ...s, clock: { ...s.clock, ...p } }));
  const flag = (k: BoolKey, label: string, hint?: string, off?: boolean) => (
    <Row label={label} hint={hint} off={off}>
      <Toggle label={label} value={t[k]} onChange={(v) => updateSettings((s) => ({ ...s, topbar: { ...s.topbar, [k]: v } }))} />
    </Row>
  );

  const sample = new Date();
  const ex = (st: DateStyle) => fmtDate(sample, c, st);
  const locales = LOCALES.some((l) => l.value === c.locale) ? LOCALES : [...LOCALES, { value: c.locale, label: c.locale }];

  return (
    <>
      <PageHeader title="Barre du haut" desc="Aspect, éléments affichés, comportement, centre de contrôle, heure et date."
        onReset={() => resetKeys(RESET_GROUPS.topbar.keys)} />
      <BarPreview />

      <Section title="Aspect">
        <Row label="Fond de la barre" hint="Transparent : seuls les icônes et le texte restent visibles sur le fond d'écran." stack>
          <Segmented<PanelBg> label="Fond de la barre" value={t.bg} onChange={(v) => setTb({ bg: v })} options={[
            { value: "glass", label: "Verre" }, { value: "solid", label: "Opaque" }, { value: "none", label: "Transparent" }]} />
        </Row>
        <Row label="Taille du texte et des icônes">
          <Slider label="Taille du texte et des icônes" def={DEFAULTS.topbar.size} value={t.size} min={11} max={16} onChange={(v) => setTb({ size: v })} format={(v) => v + " px"} />
        </Row>
        <Row label="Espacement des éléments" hint="Distance entre les icônes, à droite de la barre.">
          <Slider label="Espacement des éléments" def={DEFAULTS.topbar.gap} value={t.gap} min={4} max={32} onChange={(v) => setTb({ gap: v })} format={(v) => v + " px"} />
        </Row>
        {flag("label", "Nom « Halo » dans le menu", "Affiche le mot Halo à côté de l'hexagone, en haut à gauche.")}
      </Section>

      <Section title="Éléments affichés" desc="Choisis ce qui apparaît à droite de la barre. Le menu Halo, à gauche, reste toujours là.">
        {flag("search", "Recherche", "Loupe qui ouvre la recherche d'applications.")}
        {flag("background", "Applications en arrière-plan", "Flèche qui liste les applications actives sans fenêtre (Windows).")}
        {flag("network", "Réseau", "Indique si le PC est connecté à Internet.")}
        {flag("volume", "Volume", "Icône de son : un clic ouvre le centre de contrôle.")}
        {flag("battery", "Batterie", "Visible seulement sur un portable.")}
        {flag("batteryPercent", "Pourcentage de batterie", "Affiche le niveau à côté de l'icône.", !t.battery)}
        {flag("control", "Centre de contrôle", "Bouton à curseurs : volume, luminosité, musique, thème…")}
        {flag("clock", "Heure et date", "Horloge à droite de la barre.")}
        {flag("power", "Alimentation", "Verrouiller, mettre en veille, se déconnecter, arrêter, redémarrer.")}
      </Section>

      <Section title="Comportement">
        {flag("wheelVolume", "Molette sur le volume", "Tourne la molette de la souris sur l'icône de volume pour le régler.", !t.volume)}
        {flag("confirmPower", "Confirmer avant d'éteindre", "Arrêter, redémarrer et se déconnecter demandent un second clic.", !t.power)}
      </Section>

      <Section title="Centre de contrôle" desc="Tuiles proposées dans le panneau du centre de contrôle.">
        {flag("ccVolume", "Curseur de volume")}
        {flag("ccBrightness", "Curseur de luminosité", "Apparaît seulement si l'écran le permet (portable, écran intégré).")}
        {flag("ccMedia", "Lecteur de musique", "Affiché quand un morceau est en cours de lecture.")}
        {flag("ccTheme", "Bouton thème clair / sombre")}
        {flag("ccTaskbar", "Bouton « Masquer la barre Windows »")}
        {flag("ccSettings", "Raccourci vers les réglages")}
        {flag("ccQuit", "Bouton « Quitter Halo »")}
      </Section>

      <Section title="Heure et date" desc="Barre du haut. Les widgets Horloge ont leurs propres options (Widgets).">
        <Row label="Format de l'heure" stack>
          <Segmented<"24" | "12"> label="Format de l'heure" value={c.hour12 ? "12" : "24"} onChange={(v) => setClock({ hour12: v === "12" })} options={[
            { value: "24", label: "24 heures" }, { value: "12", label: "12 heures" }]} />
        </Row>
        <Row label="Afficher les secondes"><Toggle label="Afficher les secondes" value={c.seconds} onChange={(v) => setClock({ seconds: v })} /></Row>
        <Row label="Afficher la date dans la barre du haut"><Toggle label="Afficher la date" value={c.date} onChange={(v) => setClock({ date: v })} /></Row>
        <Row label="Style de la date" off={!c.date} hint={`Court : « ${ex("short")} » · Long : « ${ex("long")} » · Numérique : « ${ex("numeric")} ».`}>
          <Select<DateStyle> label="Style de la date" value={c.dateStyle} onChange={(v) => setClock({ dateStyle: v })} options={[
            { value: "short", label: "Court" }, { value: "long", label: "Long" }, { value: "numeric", label: "Numérique" }, { value: "none", label: "Aucune" }]} />
        </Row>
        <Row label="Afficher le jour de la semaine" off={!c.date}><Toggle label="Afficher le jour de la semaine" value={c.weekday} onChange={(v) => setClock({ weekday: v })} /></Row>
        <Row label="Langue de la date et de l'heure" hint="Noms des jours et des mois, ordre jour/mois. S'applique aussi aux widgets Horloge et Calendrier.">
          <Select label="Langue de la date et de l'heure" value={c.locale} onChange={(v) => setClock({ locale: v })} options={locales} />
        </Row>
      </Section>
    </>
  );
}
