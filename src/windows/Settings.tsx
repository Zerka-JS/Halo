import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import {
  Check, CornerDownLeft, Gauge, Image as ImageIcon, Keyboard, LayoutGrid, Monitor, PanelBottom, PanelTop, Palette, Search as SearchIcon, X, type LucideIcon,
} from "lucide-react";
import { call, on } from "../lib/tauri";
import WallpaperPage from "./settings/WallpaperPage";
import AppearancePage from "./settings/AppearancePage";
import TopBarPage from "./settings/TopBarPage";
import DockPage from "./settings/DockPage";
import WidgetsPage from "./settings/WidgetsPage";
import SearchPage from "./settings/SearchPage";
import ShortcutsPage from "./settings/ShortcutsPage";
import SystemPage from "./settings/SystemPage";
import MotionPage from "./settings/MotionPage";
import { useMotion } from "../lib/motion";
import { ActiveContext } from "../lib/active";
import { useSettings } from "../lib/settings";
import { BUILD } from "../lib/about";

interface PageDef { id: string; label: string; icon: LucideIcon }
const GROUPS: { title: string; pages: PageDef[] }[] = [
  { title: "Personnalisation", pages: [
    { id: "wallpaper", label: "Fond d'écran", icon: ImageIcon },
    { id: "appearance", label: "Apparence", icon: Palette },
  ] },
  { title: "Interface", pages: [
    { id: "topbar", label: "Barre du haut", icon: PanelTop },
    { id: "dock", label: "Dock", icon: PanelBottom },
    { id: "widgets", label: "Widgets", icon: LayoutGrid },
    { id: "search", label: "Recherche", icon: SearchIcon },
  ] },
  { title: "Comportement", pages: [
    { id: "shortcuts", label: "Raccourcis", icon: Keyboard },
    { id: "motion", label: "Animations", icon: Gauge },
    { id: "system", label: "Système", icon: Monitor },
  ] },
];
const PAGES = GROUPS.flatMap((g) => g.pages);
const pageLabel = (id: string) => PAGES.find((p) => p.id === id)?.label ?? id;

function renderPage(id: string, active: boolean, focusWidget: string | null): ReactNode {
  switch (id) {
    case "wallpaper": return <WallpaperPage />;
    case "appearance": return <AppearancePage />;
    case "topbar": return <TopBarPage />;
    case "dock": return <DockPage active={active} />;
    case "widgets": return <WidgetsPage focusId={focusWidget} />;
    case "search": return <SearchPage />;
    case "shortcuts": return <ShortcutsPage />;
    case "motion": return <MotionPage />;
    case "system": return <SystemPage />;
    default: return null;
  }
}

// ───────────── Recherche dans les réglages ─────────────
interface Entry { page: string; label: string; hint: string; section: string; hay: string }
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function searchEntries(index: Entry[], q: string): Entry[] {
  const toks = fold(q).split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  const scored: [number, Entry][] = [];
  for (const e of index) {
    if (!toks.every((t) => e.hay.includes(t))) continue;
    const l = fold(e.label);
    // Le libellé d'abord (début de mot > contient), puis le texte d'aide
    const s = toks.reduce((n, t) => n + (l.startsWith(t) ? 3 : l.includes(t) ? 2 : 0), 0);
    scored.push([s, e]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, 40).map((x) => x[1]);
}

/** « Enregistré » : petit retour discret après chaque modification (composant à part : seul lui suit les changements de réglages) */
function SavedBadge() {
  const rev = useSettings((s) => s.rev);
  const first = useRef(rev);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (rev === first.current) return;
    setOn(true);
    const t = window.setTimeout(() => setOn(false), 1600);
    return () => clearTimeout(t);
  }, [rev]);
  return (
    <span aria-live="polite" className="flex items-center gap-1 pr-3 text-[11px] mono-dim transition-opacity duration-300" style={{ opacity: on ? 1 : 0 }}>
      <Check size={12} />Enregistré
    </span>
  );
}

export default memo(function Settings() {
  const [page, setPage] = useState("wallpaper");
  const [focusWidget, setFocusWidget] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<Entry[] | null>(null);
  const [sel, setSel] = useState(0);
  const [jump, setJump] = useState<{ page: string; label: string } | null>(null);
  const mo = useMotion();
  const mainRef = useRef<HTMLElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const go = useCallback((id: string) => { setPage(id); setFocusWidget(null); setQuery(""); }, []);
  useEffect(() => { mainRef.current?.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }); }, [page]); // chaque page repart du haut

  useEffect(() => {
    const offNav = on<string>("halo-nav", (p) => {
      const [pg, arg] = String(p).split(":");
      if (PAGES.some((x) => x.id === pg)) { setPage(pg); setQuery(""); }
      setFocusWidget(arg || null);
    });
    const offVis = on<boolean>("halo-visible", (v) => setVisible(!!v));
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") call("hide_settings");
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); }
      else if (e.ctrlKey && (e.key === "PageDown" || e.key === "PageUp")) {
        e.preventDefault();
        setPage((cur) => { const i = PAGES.findIndex((p) => p.id === cur); return PAGES[(i + (e.key === "PageDown" ? 1 : -1) + PAGES.length) % PAGES.length].id; });
        setQuery("");
      }
    };
    addEventListener("keydown", k);
    return () => { offNav(); offVis(); removeEventListener("keydown", k); };
  }, []);

  // ── Index de recherche : les pages sont montées une seule fois, hors écran, et leurs lignes de réglage sont lues ──
  const needIndex = query.trim() !== "" && index === null;
  useLayoutEffect(() => {
    if (!needIndex) return;
    const root = probe.current;
    if (!root) return;
    const out: Entry[] = PAGES.map((p) => ({ page: p.id, label: p.label, hint: "", section: "Page", hay: fold(p.label + " page section") }));
    root.querySelectorAll<HTMLElement>("[data-page]").forEach((pg) => {
      const id = pg.dataset.page!;
      pg.querySelectorAll<HTMLElement>("[data-setting]").forEach((el) => {
        const label = el.dataset.setting ?? "", hint = el.querySelector("[data-hint]")?.textContent ?? "";
        const section = el.closest<HTMLElement>("[data-section]")?.dataset.section ?? "";
        out.push({ page: id, label, hint, section, hay: fold(`${label} ${hint} ${section} ${pageLabel(id)}`) });
      });
    });
    setIndex(out);
  }, [needIndex]);

  const results = useMemo(() => (index ? searchEntries(index, query) : []), [index, query]);
  useEffect(() => { setSel(0); }, [query]);

  const open = (e: Entry) => {
    setPage(e.page); setFocusWidget(null); setQuery("");
    if (e.section !== "Page") setJump({ page: e.page, label: e.label });
  };

  // Après un saut depuis la recherche : on défile jusqu'à la ligne et on la fait clignoter
  useEffect(() => {
    if (!jump || jump.page !== page) return;
    let tries = 0;
    const find = () => {
      const el = [...(mainRef.current?.querySelectorAll<HTMLElement>("[data-setting]") ?? [])].find((x) => x.dataset.setting === jump.label);
      if (!el) { if (++tries < 12) t = window.setTimeout(find, 60); else setJump(null); return; }
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      window.setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 260); // les sections hors écran viennent d'être calculées
      el.classList.remove("halo-flash"); void el.offsetWidth; el.classList.add("halo-flash");
      window.setTimeout(() => el.classList.remove("halo-flash"), 1800);
      setJump(null);
    };
    let t = window.setTimeout(find, 120);
    return () => clearTimeout(t);
  }, [jump, page]);

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { if (query) { e.stopPropagation(); setQuery(""); } else (e.target as HTMLElement).blur(); return; }
    if (!query.trim()) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter" && results[sel]) { e.preventDefault(); open(results[sel]); }
  };
  useEffect(() => { // le résultat sélectionné reste visible
    if (query) mainRef.current?.querySelector<HTMLElement>(`[data-result="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel, query]);

  const searching = query.trim() !== "";

  return (
    <ActiveContext.Provider value={visible}>
      <div className="flex h-full w-full flex-col border" style={{ background: "var(--surface)", borderColor: "var(--stroke-strong)" }}>
        <header data-tauri-drag-region className="flex h-11 shrink-0 items-center justify-between border-b pl-4" style={{ borderColor: "var(--stroke)" }}>
          <div data-tauri-drag-region className="pointer-events-none flex items-center gap-2 text-[13px] font-semibold">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--accent)" }} />Réglages de Halo
          </div>
          <div className="flex items-center">
            <SavedBadge />
            <button type="button" aria-label="Fermer" onClick={() => call("hide_settings")}
              className="flex h-11 w-12 items-center justify-center transition-colors hover:bg-red-600 hover:text-white"><X size={16} /></button>
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
          <nav aria-label="Sections" className="flex w-52 shrink-0 flex-col border-r p-3" style={{ borderColor: "var(--stroke)" }}>
            <label className="relative mb-3 block">
              <SearchIcon size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 mono-dim" />
              <input ref={searchRef} type="text" aria-label="Rechercher dans les réglages" placeholder="Rechercher…  Ctrl K" value={query} spellCheck={false}
                onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey}
                className="w-full select-text rounded-lg border py-1.5 pl-8 pr-7 text-xs outline-none placeholder:text-[var(--text-dim)]"
                style={{ background: "var(--surface-2)", borderColor: "var(--stroke)", color: "var(--text)" }} />
              {query && (
                <button type="button" aria-label="Effacer la recherche" onClick={() => { setQuery(""); searchRef.current?.focus(); }}
                  className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md hover:bg-white/10"><X size={12} /></button>
              )}
            </label>
            <div className="scroll-y -mr-1 min-h-0 flex-1 pr-1">
              {GROUPS.map((g) => (
                <div key={g.title} className="mb-3">
                  <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] mono-dim">{g.title}</div>
                  {g.pages.map((p) => {
                    const on = p.id === page && !searching, I = p.icon;
                    return (
                      <button key={p.id} type="button" aria-current={on ? "page" : undefined} onClick={() => go(p.id)}
                        className="halo-press mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-[background-color,color] duration-150"
                        style={on ? { background: "var(--accent)", color: "var(--accent-fg)" } : { color: "var(--text)" }}>
                        <I size={16} />{p.label}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="mt-2 px-1 text-[10px] leading-snug mono-dim">Halo {BUILD} · les réglages s'enregistrent automatiquement.</div>
          </nav>
          <main ref={mainRef} className="scroll-y min-w-0 flex-1 px-7 py-6">
            {searching ? (
              <div>
                <h1 className="mb-1 text-xl font-bold">Recherche</h1>
                <p className="mb-4 text-xs mono-dim">{index === null ? "Préparation de l'index…" : results.length ? `${results.length} réglage${results.length > 1 ? "s" : ""} trouvé${results.length > 1 ? "s" : ""} · ↑ ↓ pour choisir, Entrée pour ouvrir` : `Aucun réglage ne correspond à « ${query.trim()} ».`}</p>
                <div className="overflow-hidden rounded-xl border" style={{ background: "var(--surface-2)", borderColor: "var(--stroke)" }}>
                  {results.map((r, i) => (
                    <button key={r.page + r.label + i} type="button" data-result={i} onClick={() => open(r)} onMouseMove={() => setSel(i)}
                      className="flex w-full items-center gap-3 border-b px-4 py-2.5 text-left last:border-b-0"
                      style={{ borderColor: "var(--stroke)", background: i === sel ? "color-mix(in srgb, var(--accent) 16%, transparent)" : "transparent" }}>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium">{r.label}</div>
                        <div className="truncate text-[11px] mono-dim">{r.section === "Page" ? "Page de réglages" : `${pageLabel(r.page)} › ${r.section}`}{r.hint ? ` — ${r.hint}` : ""}</div>
                      </div>
                      {i === sel && <CornerDownLeft size={14} className="shrink-0 mono-dim" />}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <motion.div key={page} initial={mo.off ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: mo.dur(0.22), ease: [0.2, 0.8, 0.2, 1] }}>
                {renderPage(page, visible, focusWidget)}
              </motion.div>
            )}
          </main>
        </div>
        {/* Montage unique, hors écran, de toutes les pages pour construire l'index de recherche */}
        {needIndex && (
          <ActiveContext.Provider value={false}>
            <div ref={probe} aria-hidden className="hidden">
              {PAGES.map((p) => <div key={p.id} data-page={p.id}>{renderPage(p.id, false, null)}</div>)}
            </div>
          </ActiveContext.Provider>
        )}
      </div>
    </ActiveContext.Provider>
  );
});
