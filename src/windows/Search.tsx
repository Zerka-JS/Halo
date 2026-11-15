import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppWindow, ArrowRight, Calculator, Globe, Image as ImageIcon, LayoutGrid, Lock, LogOut, Moon, Palette, PanelBottom, PanelTop, Power, RotateCcw, Search as SearchIcon, SlidersHorizontal, Sun } from "lucide-react";
import { call, inTauri, on, send } from "../lib/tauri";
import { getSettings, updateSettings, useSettings, webSearchUrl } from "../lib/settings";
import { bumpUsage, calc, looksLikeUrl, norm, readUsage, score } from "../lib/search";

interface StartApp { name: string; target: string }
interface Item { key: string; name: string; sub: string; kind: "app" | "halo" | "web" | "url" | "calc" | "sys"; target?: string; icon?: ReactNode; confirm?: boolean; run: () => void }
type Icons = Record<string, string>;   // cible de l'application → PNG en base64 (extrait par Rust, mis en cache sur disque)

// ───────────── Raccourcis Halo (trouvables par leurs mots-clés) ─────────────
const page = (p: string) => () => call("open_settings", { page: p });
const HALO_ITEMS = [
  { name: "Réglages de Halo", kw: "reglages parametres settings options halo apparence", icon: <SlidersHorizontal size={18} />, run: page("appearance") },
  { name: "Fond d'écran", kw: "fond ecran wallpaper papier peint image", icon: <ImageIcon size={18} />, run: page("wallpaper") },
  { name: "Apparence et thème", kw: "apparence theme couleur accent police verre flou contraste", icon: <Palette size={18} />, run: page("appearance") },
  { name: "Réglages de la barre du haut", kw: "barre haut topbar horloge heure date batterie reseau centre controle", icon: <PanelTop size={18} />, run: page("topbar") },
  { name: "Réglages du dock", kw: "dock applications icones loupe zoom epingles", icon: <PanelBottom size={18} />, run: page("dock") },
  { name: "Réglages des widgets", kw: "widgets bureau horloge calendrier systeme", icon: <LayoutGrid size={18} />, run: page("widgets") },
  { name: "Raccourcis clavier", kw: "raccourcis clavier touches shortcuts hotkeys", icon: <SlidersHorizontal size={18} />, run: page("shortcuts") },
  { name: "Animations et performances", kw: "animations fluidite performance economie batterie vitesse fps", icon: <SlidersHorizontal size={18} />, run: page("motion") },
  { name: "Sauvegarder les réglages", kw: "sauvegarde export import restaurer backup reinitialiser reset systeme", icon: <SlidersHorizontal size={18} />, run: page("system") },
  { name: "Modifier les widgets", kw: "widgets bureau placer deplacer", icon: <LayoutGrid size={18} />, run: () => send("halo-edit-widgets", true) },
];

// ───────────── Commandes système (Réglages › Recherche › Commandes système) ─────────────
const SYS_ITEMS = [
  { name: "Verrouiller", kw: "verrouiller lock session", icon: <Lock size={18} />, run: () => call("power_action", { action: "lock" }) },
  { name: "Mettre en veille", kw: "veille sleep suspendre", icon: <Moon size={18} />, run: () => call("power_action", { action: "sleep" }) },
  { name: "Se déconnecter", kw: "deconnecter deconnexion logoff fermer session", icon: <LogOut size={18} />, confirm: true, run: () => call("power_action", { action: "logoff" }) },
  { name: "Redémarrer", kw: "redemarrer restart reboot", icon: <RotateCcw size={18} />, confirm: true, run: () => call("power_action", { action: "restart" }) },
  { name: "Arrêter", kw: "arreter eteindre shutdown power", icon: <Power size={18} />, confirm: true, run: () => call("power_action", { action: "shutdown" }) },
  { name: "Basculer le thème clair / sombre", kw: "theme clair sombre dark light mode", icon: <Sun size={18} />, run: () => updateSettings((s) => ({ ...s, theme: s.theme === "light" ? "dark" : "light" })) },
  { name: "Quitter Halo", kw: "quitter halo fermer exit", icon: <Power size={18} />, confirm: true, run: () => call("quit") },
];

function hue(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function Tile({ name }: { name: string }) {
  const letter = (name.match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase();
  const h = hue(name);
  return (
    <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-[15px] font-bold"
      style={{ background: `hsl(${h} 45% 34%)`, color: `hsl(${h} 80% 90%)` }}>{letter}</span>
  );
}
/** Vraie icône de l'application ; pastille colorée à initiale tant qu'elle n'est pas disponible */
function AppIcon({ name, png }: { name: string; png?: string }) {
  const [bad, setBad] = useState(false);
  useEffect(() => { setBad(false); }, [png]);
  if (!png || bad) return <Tile name={name} />;
  return <img aria-hidden alt="" draggable={false} src={`data:image/png;base64,${png}`} onError={() => setBad(true)}
    className="h-9 w-9 shrink-0 object-contain" style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,.35))" }} />;
}

/** Met en valeur les lettres tapées dans le nom (accents ignorés) */
function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const n = norm(text);
  const i = n.length === text.length ? n.indexOf(q) : -1;
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<span style={{ color: "var(--accent)" }}>{text.slice(i, i + q.length)}</span>{text.slice(i + q.length)}</>;
}

function IconTile({ children }: { children: ReactNode }) {
  return <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]" style={{ background: "var(--surface-3)" }}>{children}</span>;
}

export default function Search() {
  const [apps, setApps] = useState<StartApp[] | null>(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [usage, setUsage] = useState<Record<string, number>>(() => readUsage());
  const [icons, setIcons] = useState<Icons>({});
  const [armed, setArmed] = useState<string | null>(null);   // commande dangereuse en attente d'un second Entrée
  const cfg = useSettings((s) => s.search);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const loadApps = useCallback(() => { call<StartApp[]>("list_start_apps").then((a) => setApps(a ?? [])); }, []);
  const loadIcons = useCallback(() => {
    call<Icons>("get_app_icons").then((m) => { if (m) setIcons((p) => (Object.keys(p).length === Object.keys(m).length ? p : m)); });
  }, []);
  const focusInput = useCallback(() => { input.current?.focus(); input.current?.select(); }, []);
  const close = useCallback(() => { call("hide_search"); }, []);

  useEffect(() => {
    loadApps(); loadIcons();
    const offOpen = on<boolean>("halo-search-open", () => {
      setQ(""); setSel(0); setUsage(readUsage()); loadApps(); loadIcons();
      requestAnimationFrame(focusInput); setTimeout(focusInput, 60);
    });
    // Rust prévient quand de nouvelles icônes sont prêtes (première extraction, application installée depuis)
    const offIcons = on<boolean>("halo-icons", loadIcons);
    return () => { offOpen(); offIcons(); };
  }, [loadApps, loadIcons, focusInput]);

  const items = useMemo<Item[]>(() => {
    const nq = norm(q);
    const launch = (a: StartApp) => () => { if (cfg.remember) bumpUsage(a.target); call("launch", { target: a.target }); };
    const appItem = (a: StartApp): Item => ({ key: "a:" + a.target, name: a.name, sub: "Application", kind: "app", target: a.target, run: launch(a) });
    const all = apps ?? [];
    const use = cfg.remember ? usage : {};

    if (!nq) {
      const used = all.filter((a) => use[a.target]).sort((a, b) => use[b.target] - use[a.target]);
      return (used.length ? used : all).slice(0, cfg.recents).map(appItem);
    }

    const scored: { it: Item; s: number }[] = [];
    for (const a of all) {
      const s = score(norm(a.name), nq);
      if (s > 0) scored.push({ it: appItem(a), s: s + Math.min(use[a.target] ?? 0, 10) * 1.5 });
    }
    const extra = (list: typeof HALO_ITEMS | typeof SYS_ITEMS, kind: "halo" | "sys", sub: string) => {
      for (const h of list) {
        const s = Math.max(score(norm(h.name), nq), score(norm(h.kw), nq) * 0.8);
        if (s > 0) scored.push({ it: { key: kind + ":" + h.name, name: h.name, sub, kind, icon: <IconTile>{h.icon}</IconTile>, confirm: "confirm" in h && !!h.confirm, run: h.run }, s });
      }
    };
    if (cfg.halo) extra(HALO_ITEMS, "halo", "Halo");
    if (cfg.system) extra(SYS_ITEMS, "sys", "Système");
    scored.sort((a, b) => b.s - a.s);
    const out = scored.slice(0, cfg.max).map((x) => x.it);

    const raw = q.trim();
    const top: Item[] = [], bottom: Item[] = [];
    const r = cfg.calc ? calc(raw) : null;
    if (r) top.push({ key: "calc", name: `${raw.replace(/\s+/g, " ")} = ${r.text}`, sub: "Entrée : copier le résultat", kind: "calc", icon: <IconTile><Calculator size={18} /></IconTile>, run: () => { navigator.clipboard?.writeText(String(r.value)).catch(() => {}); } });
    if (cfg.urls && looksLikeUrl(raw)) top.push({ key: "url", name: raw, sub: "Ouvrir le lien", kind: "url", icon: <IconTile><Globe size={18} /></IconTile>, run: () => call("launch", { target: /^https?:\/\//i.test(raw) ? raw : "https://" + raw }) });
    if (cfg.web) bottom.push({ key: "web", name: `Rechercher « ${raw} » sur le web`, sub: "Web", kind: "web", icon: <IconTile><SearchIcon size={18} /></IconTile>, run: () => call("launch", { target: webSearchUrl(getSettings().search, raw) }) });
    return [...top, ...out, ...bottom];
  }, [q, apps, usage, cfg]);

  useEffect(() => { setSel(0); setArmed(null); }, [q]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel]);

  const run = (it: Item | undefined) => {
    if (!it) return;
    // Arrêter, redémarrer, se déconnecter, quitter : un second Entrée confirme
    if (it.confirm && getSettings().topbar.confirmPower && armed !== it.key) { setArmed(it.key); return; }
    if (it.kind === "calc") it.run(); // copie avant de masquer la fenêtre
    close();
    if (it.kind !== "calc") it.run();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) { e.preventDefault(); setSel((i) => (items.length ? (i + 1) % items.length : 0)); }
    else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) { e.preventDefault(); setSel((i) => (items.length ? (i - 1 + items.length) % items.length : 0)); }
    else if (e.key === "Enter") { e.preventDefault(); run(items[sel]); }
  };

  const loading = inTauri && apps === null;
  const caption = !q.trim() ? (cfg.recents === 0 ? "" : cfg.remember && Object.keys(usage).length ? "Récents" : "Applications") : "";

  return (
    // Clic sur la zone transparente autour du panneau = fermer.
    // Le panneau est collé en bas (juste au-dessus du dock) : le champ de saisie reste en bas, les résultats s'empilent au-dessus.
    <div className="flex h-full w-full items-end justify-center" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div role="dialog" aria-label="Rechercher" onKeyDown={onKey}
        className="glass glass-strong halo-pop flex max-h-full w-full flex-col overflow-hidden"
        style={{ borderRadius: "calc(var(--radius) + 4px)", transformOrigin: "bottom center" }}>
        <div ref={list} role="listbox" aria-label="Résultats" className="scroll-y min-h-0 flex-1 p-2">
          <div className="flex items-center justify-between px-2.5 pb-1 pt-0.5 text-[11px] mono-dim">
            <span className="font-semibold uppercase tracking-wider">{caption}</span>
            <span>↑ ↓ naviguer · ⏎ ouvrir</span>
          </div>
          {loading && <div className="px-3 py-6 text-center text-xs mono-dim">Chargement des applications…</div>}
          {!loading && !q.trim() && items.length === 0 && (
            <div className="px-3 py-6 text-center text-xs mono-dim">{cfg.recents === 0 ? "Commence à taper pour chercher." : inTauri ? "Aucune application trouvée." : "La liste des applications n'est disponible que dans l'application Halo (Windows)."}</div>
          )}
          {items.map((it, i) => (
            <button key={it.key} type="button" role="option" aria-selected={i === sel} data-i={i}
              onMouseMove={() => i !== sel && setSel(i)} onClick={() => run(it)}
              className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors"
              style={i === sel ? { background: "color-mix(in srgb, var(--accent) 24%, transparent)", boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent)" } : undefined}>
              {it.kind === "app" ? <AppIcon name={it.name} png={icons[it.target ?? ""]} /> : (it.icon ?? <IconTile><AppWindow size={18} /></IconTile>)}
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{it.kind === "app" ? <Highlight text={it.name} q={norm(q)} /> : it.name}</span>
              <span className="shrink-0 text-[11px]" style={armed === it.key ? { color: "var(--accent)", fontWeight: 600 } : { color: "var(--text-dim)" }}>{armed === it.key ? "Entrée pour confirmer" : it.sub}</span>
              {i === sel && <ArrowRight size={14} className="shrink-0 opacity-60" aria-hidden />}
            </button>
          ))}
        </div>

        <div className="h-px shrink-0" style={{ background: "var(--stroke)" }} />

        <div className="flex shrink-0 items-center gap-3 px-4 py-3.5">
          <SearchIcon size={20} className="shrink-0 opacity-70" aria-hidden />
          <input ref={input} autoFocus value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} autoComplete="off"
            aria-label="Rechercher une application" placeholder="Rechercher une application, un lien ou sur le web…"
            className="min-w-0 flex-1 select-text bg-transparent text-[17px] outline-none placeholder:text-[var(--text-dim)]" />
          <kbd className="rounded-md border px-1.5 py-0.5 text-[10px] mono-dim" style={{ borderColor: "var(--stroke-strong)" }}>Échap</kbd>
        </div>
      </div>
    </div>
  );
}
