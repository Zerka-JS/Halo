import { useRef, useState } from "react";
import { Dices, Link2, Plus, Upload } from "lucide-react";
import { call } from "../../lib/tauri";
import { newId, RESET_GROUPS, resetKeys, updateSettings, useSettings } from "../../lib/settings";
import { useActive } from "../../lib/active";
import { ART_WALLPAPERS, cacheCustomImage, fileKind, importImage, importMedia, mediaKindOfId, MEDIA_ACCEPT, probeImage, SOBER_WALLPAPERS, useFileWallpaperExists, WallpaperArt } from "../../lib/wallpapers";
import { configuredLinks, isHttpUrl, linkId } from "../../lib/wallpaper-links";
import { Btn, PageHeader, Row, Section, Segmented, Slider, TextInput, Toggle } from "../../components/ui";
import WallpaperSwitcher, { type SwitcherGroup, type SwitcherItem } from "../../components/WallpaperSwitcher";

const KIND_LABEL = { image: "Image", video: "Vidéo", audio: "Son" } as const;

export default function WallpaperPage() {
  const w = useSettings((x) => x.wallpaper);
  const accent = useSettings((x) => x.accent);
  const customWallpapers = useSettings((x) => x.customWallpapers);
  const linkWallpapers = useSettings((x) => x.linkWallpapers);
  const s = { accent, customWallpapers, linkWallpapers };
  const active = useActive();
  const fileInput = useRef<HTMLInputElement>(null);
  const fileExists = useFileWallpaperExists();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState("");

  // Ajout par lien
  const [url, setUrl] = useState("");
  const [linkName, setLinkName] = useState("");
  const [tone, setTone] = useState<"auto" | "dark" | "light">("auto");
  const [adding, setAdding] = useState(false);
  const [linkErr, setLinkErr] = useState("");

  const pick = (id: string) => updateSettings((x) => ({ ...x, wallpaper: { ...x.wallpaper, id } }));
  const setWp = (p: Partial<typeof w>) => updateSettings((x) => ({ ...x, wallpaper: { ...x.wallpaper, ...p } }));

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true); setErr("");
    try {
      for (const f of Array.from(files)) {
        const kind = fileKind(f);
        if (!kind) throw new Error("Format non pris en charge");
        const label = f.name.replace(/\.[^.]+$/, "").slice(0, 28) || (kind === "image" ? "Image" : kind === "video" ? "Vidéo" : "Son");
        const name = newId("");
        if (kind === "image") {
          const { dataUrl, tone } = await importImage(f);
          const ok = await call<boolean>("save_wallpaper", { name, data: dataUrl });
          if (ok === false) throw new Error("Enregistrement impossible");
          const id = "img:" + name;
          cacheCustomImage(id, dataUrl);
          updateSettings((x) => ({
            ...x, customWallpapers: [...x.customWallpapers, { id, name: label, tone }],
            wallpaper: { ...x.wallpaper, id },
          }));
        } else {
          setProgress(0);
          await importMedia(f, name, setProgress);
          const id = (kind === "video" ? "vid:" : "aud:") + name;
          updateSettings((x) => ({
            ...x, customWallpapers: [...x.customWallpapers, { id, name: label, tone: "dark" }],
            wallpaper: { ...x.wallpaper, id },
          }));
        }
      }
    } catch { setErr("Ce fichier n'a pas pu être importé (images JPG, PNG, WebP… · vidéos MP4, WebM · sons MP3, M4A, OGG, WAV)."); }
    setBusy(false); setProgress(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const remove = (id: string) => {
    call("delete_wallpaper", { name: id.slice(4) });
    updateSettings((x) => ({
      ...x, customWallpapers: x.customWallpapers.filter((c) => c.id !== id),
      wallpaper: x.wallpaper.id === id ? { ...x.wallpaper, id: "graphite" } : x.wallpaper,
    }));
  };

  const removeLink = (u: string) => updateSettings((x) => ({
    ...x, linkWallpapers: x.linkWallpapers.filter((l) => l.url !== u),
    wallpaper: x.wallpaper.id === linkId(u) ? { ...x.wallpaper, id: "graphite" } : x.wallpaper,
  }));

  const addLink = async () => {
    const u = url.trim();
    setLinkErr("");
    if (!isHttpUrl(u)) { setLinkErr("Colle l'adresse complète de l'image, qui commence par https://"); return; }
    setAdding(true);
    const r = await probeImage(u);
    setAdding(false);
    if (!r.ok) { setLinkErr("Ce lien ne renvoie pas d'image. Utilise « Copier l'adresse de l'image » (clic droit sur l'image)."); return; }
    let host = "Lien";
    try { host = new URL(u).pathname.split("/").filter(Boolean).pop()?.replace(/\.[^.]+$/, "") || new URL(u).hostname; } catch { /* ignore */ }
    const t = tone === "auto" ? r.tone ?? "dark" : tone;
    updateSettings((x) => ({
      ...x,
      linkWallpapers: [...x.linkWallpapers.filter((l) => l.url !== u), { url: u, name: (linkName.trim() || host).slice(0, 28), tone: t }],
      wallpaper: { ...x.wallpaper, id: linkId(u) },
    }));
    setUrl(""); setLinkName("");
  };

  const common = { accent: s.accent, color: w.color, seed: w.seed };
  const seeded = ["sakura", "stars", "dusk", "dunes", "forest", "ocean"].includes(w.id);
  const kind = mediaKindOfId(w.id);

  // Catégories du carrousel (comme les onglets du Wallpaper Switcher)
  const collection: SwitcherItem[] = [];
  const seen = new Set<string>();
  const add = (it: SwitcherItem) => { if (!seen.has(it.id)) { seen.add(it.id); collection.push(it); } };
  configuredLinks().forEach((l) => add({ id: linkId(l.url), name: l.name, label: "Lien", thumb: l.thumb }));
  s.linkWallpapers.forEach((l) => add({ id: linkId(l.url), name: l.name, label: "Lien", onRemove: () => removeLink(l.url) }));
  if (fileExists) add({ id: "file", name: "wallpaper.jpg", label: "Image" });
  s.customWallpapers.forEach((c) => add({ id: c.id, name: c.name, label: KIND_LABEL[mediaKindOfId(c.id) ?? "image"], onRemove: () => remove(c.id) }));
  const groups: SwitcherGroup[] = [
    { id: "collection", label: "Ma collection", items: collection },
    { id: "sober", label: "Sobres", items: SOBER_WALLPAPERS.map((b) => ({ id: b.id, name: b.name, label: "Dégradé" })) },
    { id: "art", label: "Illustrations", items: ART_WALLPAPERS.map((b) => ({ id: b.id, name: b.name, label: "Illustration" })) },
  ];

  return (
    <>
      <PageHeader title="Fond d'écran" desc="Choisis un fond dans le carrousel, règle l'effet de transition et l'aspect du fond."
        onReset={() => resetKeys(RESET_GROUPS.wallpaper.keys)} resetLabel="Rétablir le fond" />

      <WallpaperSwitcher groups={groups} currentId={w.id} onApply={pick} transition={w.transition} onTransition={(transition) => setWp({ transition })}
        animated={w.animated && active} {...common}
        empty={<>Rien ici pour l'instant. Importe une image, une vidéo (MP4) ou un son (MP3) de ton PC, colle un lien d'image plus bas, ou remplis les lignes prêtes dans <code>src/lib/wallpaper-links.ts</code>.</>} />

      <Section title="Ajouter à ma collection" desc="Fichiers importés depuis ton PC (images, vidéos MP4 / WebM, sons MP3) et liens d'images : ils apparaissent dans « Ma collection ». Tu peux aussi remplir src/lib/wallpaper-links.ts.">
        <Row label="Importer un fichier" hint="Image (JPG, PNG, WebP…), vidéo (MP4, WebM) ou son (MP3, M4A, OGG, WAV). Plusieurs à la fois possible.">
          <div className="flex flex-col items-end gap-2">
            <Btn onClick={() => fileInput.current?.click()} disabled={busy} label="Importer une image, une vidéo ou un son">
              <Upload size={14} />{busy ? (progress === null ? "Import…" : `Import… ${Math.round(progress * 100)} %`) : "Importer un fichier"}
            </Btn>
            <input ref={fileInput} type="file" accept={MEDIA_ACCEPT} multiple hidden onChange={(e) => onFiles(e.target.files)} />
          </div>
        </Row>
        {err && <p role="alert" className="border-b px-4 py-3 text-xs" style={{ color: "var(--accent)", borderColor: "var(--stroke)" }}>{err}</p>}
        <Row label="Ajouter par lien" hint="Adresse directe d'une image (clic droit sur l'image › « Copier l'adresse de l'image »)." stack>
          <div className="flex flex-col gap-2">
            <TextInput label="Adresse de l'image" value={url} onChange={setUrl} placeholder="https://…/mon-fond.jpg" width="100%" />
            <div className="flex flex-wrap items-center gap-2">
              <TextInput label="Nom (facultatif)" value={linkName} onChange={setLinkName} placeholder="Nom (facultatif)" width={190} />
              <Segmented label="Luminosité de l'image" value={tone} onChange={setTone}
                options={[{ value: "auto", label: "Auto" }, { value: "dark", label: "Sombre" }, { value: "light", label: "Clair" }]} />
              <div className="ml-auto"><Btn variant="accent" onClick={addLink} disabled={!url.trim() || adding}>{adding ? <Link2 size={14} /> : <Plus size={14} />}{adding ? "Vérification…" : "Ajouter"}</Btn></div>
            </div>
            {linkErr && <p role="alert" className="text-xs" style={{ color: "var(--accent)" }}>{linkErr}</p>}
            <p className="text-[11px] leading-snug mono-dim">« Clair / Sombre » règle la couleur de l'horloge posée sur le fond ; « Auto » le devine quand le site le permet.</p>
          </div>
        </Row>
      </Section>

      <Section title="Réglages du fond">
        <div className="border-b p-4" style={{ borderColor: "var(--stroke)" }}>
          <div className="relative aspect-video w-full max-w-sm overflow-hidden rounded-xl border" style={{ borderColor: "var(--stroke-strong)" }}>
            <WallpaperArt id={w.id} {...common} animated={w.animated && active} volume={w.volume} preview />
            <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${w.dim})`, backdropFilter: w.blur ? `blur(${w.blur}px)` : undefined }} />
          </div>
          <p className="mt-2 text-[11px] mono-dim">Aperçu du fond appliqué, avec les réglages ci-dessous.</p>
        </div>
        <Row label="Assombrissement" hint="Améliore la lisibilité des widgets."><Slider label="Assombrissement" def={28} value={Math.round(w.dim * 100)} min={0} max={85} onChange={(v) => setWp({ dim: v / 100 })} format={(v) => v + " %"} /></Row>
        <Row label="Flou"><Slider label="Flou" def={0} value={w.blur} min={0} max={24} onChange={(v) => setWp({ blur: v })} format={(v) => v + " px"} /></Row>
        <Row label="Saturation" hint="0 % = noir et blanc · 100 % = couleurs d'origine · 200 % = couleurs éclatantes."><Slider label="Saturation du fond" def={100} value={Math.round(w.saturate * 100)} min={0} max={200} step={5} onChange={(v) => setWp({ saturate: v / 100 })} format={(v) => v + " %"} /></Row>
        <Row label="Vignette" hint="Assombrit les bords pour mettre le centre en valeur."><Slider label="Vignette" def={0} value={Math.round(w.vignette * 100)} min={0} max={90} step={5} onChange={(v) => setWp({ vignette: v / 100 })} format={(v) => v + " %"} /></Row>
        {kind === "video" && (
          <Row label="Son de la vidéo" hint="Coupé par défaut. Le son n'est joué que par l'écran principal.">
            <Toggle label="Son de la vidéo" value={w.sound} onChange={(v) => setWp({ sound: v })} />
          </Row>
        )}
        {(kind === "audio" || (kind === "video" && w.sound)) && (
          <Row label="Volume du fond" hint={kind === "audio" ? "Le morceau tourne en boucle derrière le bureau. Au tout premier lancement, un clic sur le bureau peut être nécessaire pour déclencher le son." : undefined}>
            <Slider label="Volume du fond" value={Math.round(w.volume * 100)} min={0} max={100} onChange={(v) => setWp({ volume: v / 100 })} format={(v) => v + " %"} />
          </Row>
        )}
        <Row label="Animations du fond" hint="Aurore, constellations, vidéo, visualiseur… Désactive pour économiser la batterie (la vidéo se met en pause, un morceau continue de jouer)."><Toggle label="Animations du fond" value={w.animated} onChange={(v) => setWp({ animated: v })} /></Row>
        {w.animated && <Row label="Vitesse des animations du fond" hint="Aurore, blobs, constellations… 100 % = vitesse d'origine."><Slider label="Vitesse des animations du fond" def={100} value={Math.round(w.speed * 100)} min={25} max={300} step={5} onChange={(v) => setWp({ speed: v / 100 })} format={(v) => v + " %"} /></Row>}
        {w.animated && <Row label="Images par seconde" hint="Constellations et visualiseur MP3. 60 = plus fluide, 15 = plus économe (batterie, ventilateurs).">
          <Segmented<"15" | "30" | "60"> label="Images par seconde" value={String(w.fps) as "15" | "30" | "60"} onChange={(v) => setWp({ fps: +v })} options={[
            { value: "15", label: "15" }, { value: "30", label: "30" }, { value: "60", label: "60" }]} />
        </Row>}
        {seeded && <Row label="Variante" hint="Génère une autre composition pour ce fond."><Btn onClick={() => setWp({ seed: Math.floor(Math.random() * 99999) + 1 })}><Dices size={14} />Nouvelle variante</Btn></Row>}
        {w.id === "solid" && (
          <Row label="Couleur"><input type="color" aria-label="Couleur du fond" value={w.color} onChange={(e) => setWp({ color: e.target.value })} className="h-8 w-14 cursor-pointer rounded border-0 bg-transparent" /></Row>
        )}
      </Section>
    </>
  );
}
