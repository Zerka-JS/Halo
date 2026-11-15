import { useEffect, useRef, useState } from "react";
import { ClipboardCopy, Download, FolderOpen, Power, RotateCcw, Upload } from "lucide-react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { call, inTauri } from "../../lib/tauri";
import { exportSettings, importSettings, RESET_GROUPS, resetKeys, resetSettings, updateSettings, useSettings } from "../../lib/settings";
import { BUILD } from "../../lib/about";
import { useAudioDevices } from "../../lib/sys";
import { Btn, Notice, PageHeader, Row, Section, Select, Toggle } from "../../components/ui";

/** Bouton à deux temps : un premier clic arme, le second confirme (se désarme seul après quelques secondes) */
function ConfirmBtn({ label, onConfirm, variant = "default" }: { label: string; onConfirm: () => void; variant?: "default" | "danger" }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 3500);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Btn variant={armed ? "accent" : variant} onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}>
      <RotateCcw size={13} />{armed ? "Confirmer ?" : label}
    </Btn>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export default function SystemPage() {
  const hideTaskbar = useSettings((s) => s.hideTaskbar);
  const hideFull = useSettings((s) => s.autoHideFullscreen);
  const hideMax = useSettings((s) => s.autoHideMaximized);
  const rev = useSettings((s) => s.rev);
  const audioDevice = useSettings((s) => s.audio.device);
  const dev = useAudioDevices();
  // Ce que Halo voit côté son, dit en clair (Wave Link compris)
  const wave = dev.names.filter((n) => /wave link/i.test(n));
  const real = dev.names.filter((n) => !/wave link/i.test(n));
  const audioNotice: { tone: "info" | "warn"; text: string } = dev.legacy
    ? { tone: "warn", text: `Le démon audio a dû démarrer en version d'origine (le choix de sortie n'a pas pu être chargé). Cause : ${dev.legacy}. Copie ce message pour le dépannage (bouton « Copier le diagnostic » plus bas).` }
    : !dev.known
      ? { tone: "warn", text: `Halo n'a pas reçu la liste des sorties audio. Ferme complètement Halo (aussi dans la zone de notification) puis relance « npm run tauri dev » : cette fonction demande la version ${BUILD} compilée. Elle ne marche pas dans un simple navigateur.` }
      : wave.length === 0
        ? { tone: "info", text: `Wave Link non détecté (lance Wave Link pour qu'il apparaisse). Sorties vues : ${dev.names.join(", ") || "aucune"}. Volume piloté sur : ${dev.selected || "sortie par défaut"}.` }
        : /wave link/i.test(dev.selected)
          ? { tone: "warn", text: `Wave Link détecté, mais le volume est piloté sur une sortie virtuelle (${dev.selected}) : son niveau ne change pas le vrai son. Choisis ta vraie sortie dans la liste${real.length ? ` (${real.join(", ")})` : ""}.` }
          : { tone: "info", text: `Wave Link détecté (${wave.length} sortie${wave.length > 1 ? "s" : ""} virtuelle${wave.length > 1 ? "s" : ""}). Le volume est piloté sur « ${dev.selected} ».` };
  const [auto, setAuto] = useState(false);
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => { if (inTauri) isEnabled().then(setAuto).catch(() => {}); }, []);
  useEffect(() => {
    if (!msg) return;
    const t = window.setTimeout(() => setMsg(null), 6000);
    return () => clearTimeout(t);
  }, [msg]);

  const toggleAuto = (v: boolean) => {
    setAuto(v);
    if (inTauri) (v ? enable() : disable()).catch(() => setAuto(!v));
  };
  const toggleTaskbar = (v: boolean) => {
    updateSettings((x) => ({ ...x, hideTaskbar: v }));
    call("set_shell_mode", { enabled: v });
  };

  const doImport = (text: string) => {
    const r = importSettings(text);
    setMsg(r.ok ? { ok: true, text: "Réglages importés. Les fonds d'écran importés depuis un autre PC (images, vidéos, sons) ne sont pas repris." } : { ok: false, text: r.error });
    if (r.ok) setPaste("");
  };
  const stamp = () => new Date().toISOString().slice(0, 10);
  const copyExport = () => navigator.clipboard?.writeText(exportSettings()).then(
    () => setMsg({ ok: true, text: "Réglages copiés dans le presse-papiers." }),
    () => setMsg({ ok: false, text: "Le presse-papiers n'est pas accessible : utilise « Enregistrer dans un fichier »." }));
  const openFolder = async () => {
    try {
      const { appConfigDir } = await import("@tauri-apps/api/path");
      await call("launch", { target: await appConfigDir() });
    } catch { setMsg({ ok: false, text: "Impossible d'ouvrir le dossier ici." }); }
  };

  const diag = () => {
    const nav = navigator as Navigator & { getBattery?: unknown };
    return [
      `Halo ${BUILD}`,
      `Application Tauri : ${inTauri ? "oui" : "non (navigateur)"}`,
      `Système : ${navigator.platform || "?"} · ${navigator.language}`,
      `Navigateur : ${navigator.userAgent}`,
      `Écran : ${screen.width}×${screen.height} · échelle ${devicePixelRatio}`,
      `API batterie : ${nav.getBattery ? "oui" : "non"}`,
      `Sorties audio : ${dev.known ? dev.names.join(" ; ") || "aucune" : dev.legacy ? "démon en version d'origine : " + dev.legacy : "pas de réponse du démon"} · pilotée : ${dev.selected || "-"} · choix : ${audioDevice || "(défaut)"}`,
      `Réglages : ${(exportSettings().length / 1024).toFixed(1)} Ko · dernière modification ${rev ? new Date(rev).toLocaleString() : "jamais"}`,
    ].join("\n");
  };

  return (
    <>
      <PageHeader title="Système" desc="Démarrage, barre Windows, sauvegarde de tes réglages et informations de diagnostic." />

      <Section title="Démarrage et barre Windows">
        <Row label="Masquer la barre des tâches Windows" hint="Halo la remplace par sa barre du haut et son dock. Elle revient toute seule en quittant Halo."><Toggle label="Masquer la barre Windows" value={hideTaskbar} onChange={toggleTaskbar} /></Row>
        <Row label="Masquer la barre et le dock en plein écran" hint="Quand une application passe en plein écran, y compris en « plein écran fenêtré » (jeu, vidéo, navigateur en F11), la barre du haut et le dock s'effacent sur cet écran et reviennent ensuite."><Toggle label="Masquer en plein écran" value={hideFull} onChange={(v) => updateSettings((x) => ({ ...x, autoHideFullscreen: v }))} /></Row>
        <Row label="Masquer aussi quand une fenêtre est agrandie" off={!hideFull} hint="Une fenêtre agrandie (bouton □) occupe alors tout l'écran. Pour rappeler les barres : pousse la souris contre le bord du bas (le dock), ou contre le bord du haut en y restant une demi-seconde (la barre du haut). Sans effet si le réglage ci-dessus est désactivé."><Toggle label="Masquer avec les fenêtres agrandies" value={hideMax} onChange={(v) => updateSettings((x) => ({ ...x, autoHideMaximized: v }))} /></Row>
        <Row label="Lancer Halo au démarrage de Windows"><Toggle label="Lancer au démarrage" value={auto} onChange={toggleAuto} /></Row>
      </Section>

      <Section title="Sauvegarde et restauration" desc="Garde une copie de tes réglages, ou retrouve-les sur un autre PC.">
        {msg && <div className="px-4 pt-3"><Notice tone={msg.ok ? "info" : "warn"}>{msg.text}</Notice></div>}
        <Row label="Exporter les réglages" hint="Fichier JSON : thème, fond choisi, barre, dock, widgets, recherche et raccourcis.">
          <div className="flex gap-2">
            <Btn onClick={() => download(`halo-reglages-${stamp()}.json`, exportSettings())}><Download size={13} />Enregistrer dans un fichier</Btn>
            <Btn onClick={copyExport}><ClipboardCopy size={13} />Copier</Btn>
          </div>
        </Row>
        <Row label="Importer depuis un fichier" hint="Remplace tes réglages actuels par ceux du fichier. Les fonds d'écran importés (images, vidéos, sons) ne voyagent pas avec le fichier.">
          <>
            <input ref={file} type="file" accept=".json,application/json" hidden aria-label="Fichier de réglages"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) f.text().then(doImport).catch(() => setMsg({ ok: false, text: "Fichier illisible." })); }} />
            <Btn onClick={() => file.current?.click()}><Upload size={13} />Choisir un fichier…</Btn>
          </>
        </Row>
        <Row label="Importer en collant le contenu" stack>
          <div className="flex gap-2">
            <textarea aria-label="Contenu d'un fichier de réglages" value={paste} onChange={(e) => setPaste(e.target.value)} rows={3} spellCheck={false} placeholder='{ "halo": "settings", … }'
              className="min-w-0 flex-1 select-text resize-none rounded-lg border px-2.5 py-1.5 font-mono text-[11px] outline-none placeholder:text-[var(--text-dim)]"
              style={{ background: "var(--surface-3)", borderColor: "var(--stroke)", color: "var(--text)" }} />
            <div className="self-end"><Btn variant="accent" onClick={() => doImport(paste)} disabled={!paste.trim()}><Upload size={13} />Importer</Btn></div>
          </div>
        </Row>
        <Row label="Dossier de configuration" hint="Contient settings.json et les fonds d'écran importés.">
          <Btn onClick={openFolder} disabled={!inTauri}><FolderOpen size={13} />Ouvrir</Btn>
        </Row>
      </Section>

      <Section title="Réinitialisation" desc="Rétablis une seule catégorie, ou tout. Il faut confirmer par un second clic.">
        {Object.entries(RESET_GROUPS).map(([id, g]) => (
          <Row key={id} label={`Rétablir : ${g.label}`}>
            <ConfirmBtn label="Rétablir" onConfirm={() => resetKeys(g.keys)} />
          </Row>
        ))}
        <Row label="Rétablir tous les réglages" hint="Thème, fond d'écran, barre, dock, widgets, recherche et raccourcis reviennent aux valeurs d'origine (tes fonds importés sont conservés).">
          <ConfirmBtn label="Tout rétablir" variant="danger" onConfirm={resetSettings} />
        </Row>
      </Section>

      <Section title="Son et Spotify" desc="Halo lit le volume réel de Windows et les contrôles média (SMTC).">
        <div className="px-4 pt-3">
          <Notice tone={audioNotice.tone}>{audioNotice.text}</Notice>
        </div>
        <Row label="Sortie du volume (Wave Link…)" off={!dev.known} stack
          hint="Avec Elgato Wave Link, la sortie par défaut de Windows est une carte virtuelle dont le volume ne change pas le vrai son : « Automatique » (recommandé) ou ta vraie sortie (casque, enceintes) font suivre le vrai volume à l'icône de volume, au curseur et à la molette.">
          <Select<string> label="Sortie du volume" value={audioDevice} onChange={(v) => updateSettings((x) => ({ ...x, audio: { device: v } }))} options={[
            { value: "@auto", label: "Automatique (recommandé, compatible Wave Link)" },
            { value: "", label: "Sortie par défaut de Windows" },
            ...dev.names.map((n) => ({ value: n, label: n })),
            ...(audioDevice && audioDevice !== "@auto" && !dev.names.includes(audioDevice) ? [{ value: audioDevice, label: `${audioDevice} (non connectée)` }] : []),
          ]} />
        </Row>
        <div className="px-4 py-3 text-xs leading-relaxed mono-dim">
          L'indicateur de son suit le niveau de la sortie audio par défaut. Le widget Spotify fonctionne avec l'application Spotify de Windows
          (et le Spotify Web dans un navigateur) : titre, pochette, progression, pause, précédent et suivant, sans compte ni clé API.
        </div>
      </Section>

      <Section title="À propos et diagnostic">
        <Row label="Version" hint="Numéro de cette version de l'interface de Halo."><span className="text-xs tabular-nums">Halo {BUILD}</span></Row>
        <Row label="Informations pour le dépannage" hint="Copie ces informations si tu dois décrire un problème.">
          <Btn onClick={() => navigator.clipboard?.writeText(diag()).then(() => setMsg({ ok: true, text: "Diagnostic copié dans le presse-papiers." }), () => {})}><ClipboardCopy size={13} />Copier le diagnostic</Btn>
        </Row>
        <Row label="Quitter Halo" hint="Ferme la barre, le dock et le bureau ; la barre Windows revient."><Btn variant="danger" onClick={() => call("quit")}><Power size={13} />Quitter</Btn></Row>
      </Section>
    </>
  );
}
