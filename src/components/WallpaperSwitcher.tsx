import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type WheelEvent } from "react";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { WallpaperArt } from "../lib/wallpapers";
import { useMotion } from "../lib/motion";
import type { WpTransition } from "../lib/settings";
import { Segmented } from "./ui";

export interface SwitcherItem {
  id: string; name: string;
  /** Étiquette en haut à gauche de la carte centrale (IMAGE, VIDÉO…) */
  label: string;
  /** Vignette plus légère (liens) */
  thumb?: string;
  onRemove?: () => void;
}
export interface SwitcherGroup { id: string; label: string; items: SwitcherItem[] }

const TRANSITIONS: { value: WpTransition; label: string }[] = [
  { value: "circle", label: "Cercle" }, { value: "wipe", label: "Balayage" }, { value: "dots", label: "Points" },
  { value: "fade", label: "Fondu" }, { value: "none", label: "Aucune" },
];

const MONO = "font-mono uppercase tracking-[0.14em]";

/** Sélecteur de fond d'écran en carrousel 3D (← → parcourir · ↑ ↓ catégorie · Entrée appliquer) */
export default function WallpaperSwitcher({ groups, currentId, onApply, transition, onTransition, accent, color, seed, animated, empty }: {
  groups: SwitcherGroup[]; currentId: string; onApply: (id: string) => void;
  transition: WpTransition; onTransition: (t: WpTransition) => void;
  accent: string; color: string; seed: number; animated: boolean;
  /** Texte affiché quand la catégorie ouverte est vide */
  empty?: ReactNode;
}) {
  const mo = useMotion();
  const locate = (id: string) => {
    for (const g of groups) { const i = g.items.findIndex((x) => x.id === id); if (i >= 0) return { g: g.id, i }; }
    return null;
  };
  const [gid, setGid] = useState(() => locate(currentId)?.g ?? groups.find((g) => g.items.length)?.id ?? groups[0].id);
  const [idx, setIdx] = useState(() => locate(currentId)?.i ?? 0);
  const lastWheel = useRef(0);
  const root = useRef<HTMLDivElement>(null);

  // Quand le fond appliqué change (clic, import, ajout par lien…), le carrousel se recentre dessus
  useEffect(() => {
    const l = locate(currentId);
    if (l) { setGid(l.g); setIdx(l.i); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  const group = groups.find((g) => g.id === gid) ?? groups[0];
  const items = group.items;
  const cur = Math.min(idx, Math.max(0, items.length - 1));
  const item = items[cur] as SwitcherItem | undefined;
  const applied = !!item && item.id === currentId;

  const go = (d: number) => setIdx(Math.max(0, Math.min(items.length - 1, cur + d)));
  const openGroup = (id: string) => {
    if (id === gid) return;
    const g = groups.find((x) => x.id === id);
    setGid(id);
    setIdx(Math.max(0, g?.items.findIndex((x) => x.id === currentId) ?? 0));
  };
  const shiftGroup = (d: number) => {
    const i = groups.findIndex((g) => g.id === gid);
    const n = groups[(i + d + groups.length) % groups.length];
    openGroup(n.id);
  };
  const apply = (it: SwitcherItem | undefined) => { if (it && it.id !== currentId) onApply(it.id); };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // les boutons gardent leur comportement (Entrée / Espace)
    switch (e.key) {
      case "ArrowRight": go(1); break;
      case "ArrowLeft": go(-1); break;
      case "Home": setIdx(0); break;
      case "End": setIdx(items.length - 1); break;
      case "ArrowDown": shiftGroup(1); break;
      case "ArrowUp": shiftGroup(-1); break;
      case "Enter": case " ": apply(item); break;
      default: return;
    }
    e.preventDefault();
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    // Défilement horizontal (pavé tactile, souris à molette latérale) ; le défilement vertical de la page reste libre
    if (Math.abs(e.deltaX) < 24 || Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;
    const now = performance.now();
    if (now - lastWheel.current < 200) return;
    lastWheel.current = now;
    go(e.deltaX > 0 ? 1 : -1);
  };

  const dur = mo.dur(0.5);
  const ease = "cubic-bezier(.2,.8,.2,1)";

  return (
    <div ref={root} role="group" aria-label="Choix du fond d'écran" tabIndex={0} onKeyDown={onKey} onWheel={onWheel}
      onClick={() => root.current?.focus({ preventScroll: true })} /* le clavier (← →) marche tout de suite après un clic */
      className="mb-6 select-none rounded-2xl border outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      style={{ background: "var(--surface-2)", borderColor: "var(--stroke)" }}>
      {/* En-tête : titre · catégories · compteur */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-3.5">
        <div className={`flex items-center gap-2 text-[10px] font-semibold ${MONO}`}>
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--accent)" }} />Fonds d'écran
        </div>
        <div role="tablist" aria-label="Catégorie" className="flex rounded-full p-0.5" style={{ background: "var(--surface-3)" }}>
          {groups.map((g) => {
            const on = g.id === gid;
            return (
              <button key={g.id} type="button" role="tab" aria-selected={on} tabIndex={-1} onClick={() => openGroup(g.id)}
                className="rounded-full px-3 py-1 text-[11px] font-medium transition-colors"
                style={on ? { background: "var(--text)", color: "var(--surface)" } : { color: "var(--text-dim)" }}>
                {g.label}{g.items.length > 0 && <span className="ml-1 opacity-60">{g.items.length}</span>}
              </button>
            );
          })}
        </div>
        <div className={`min-w-12 text-right text-[10px] tabular-nums mono-dim ${MONO}`} aria-live="polite">
          {item ? `${cur + 1} / ${items.length}` : "0 / 0"}
        </div>
      </div>

      {/* Scène 3D */}
      <div className="relative mx-auto w-full overflow-hidden" style={{ aspectRatio: "2.4 / 1", perspective: 1100 }}>
        {!items.length && (
          <div className="absolute inset-0 flex items-center justify-center px-10 text-center text-xs leading-relaxed mono-dim">{empty ?? "Rien ici pour l'instant."}</div>
        )}
        {items.map((it, i) => {
          const off = i - cur, a = Math.abs(off);
          if (a > 3) return null;
          const sign = Math.sign(off);
          const tx = a === 0 ? 0 : sign * (54 + (a - 1) * 20);
          const isCur = a === 0, isApplied = it.id === currentId;
          return (
            <div key={it.id} className="absolute left-1/2 top-1/2" aria-hidden={a > 1}
              style={{
                width: "50%", aspectRatio: "16 / 9", zIndex: 10 - a,
                transform: `translate(${-50 + tx}%, -50%) translateZ(${-a * 60}px) rotateY(${-sign * 42}deg) scale(${isCur ? 1 : 0.86})`,
                opacity: [1, 0.95, 0.65, 0.32][a],
                transition: dur ? `transform ${dur}s ${ease}, opacity ${dur}s ${ease}` : "none",
                willChange: "transform",
              }}>
              <button type="button" tabIndex={-1} aria-label={isCur ? `${it.name} — appliquer` : it.name} aria-current={isApplied ? "true" : undefined}
                onClick={() => (isCur ? apply(it) : setIdx(i))} onDoubleClick={() => apply(it)}
                className="absolute inset-0 block overflow-hidden rounded-xl border text-left"
                style={{
                  borderColor: isCur ? "rgb(255 255 255 / .3)" : "var(--stroke-strong)", background: "#0b0c0d",
                  boxShadow: isCur ? "0 18px 50px -12px rgb(0 0 0 / .65), 0 0 0 1px rgb(255 255 255 / .06)" : "0 10px 30px -10px rgb(0 0 0 / .6)",
                }}>
                {a <= 2 && (it.thumb
                  ? <img src={it.thumb} alt="" loading="lazy" draggable={false} referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" />
                  : <WallpaperArt id={it.id} accent={accent} color={color} seed={seed} animated={isCur && animated} preview />)}
                {isCur && <span className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(to bottom, rgb(0 0 0 / .45), transparent 28%, transparent 68%, rgb(0 0 0 / .55))" }} />}
                {!isCur && <span className="pointer-events-none absolute inset-0 bg-black transition-opacity" style={{ opacity: Math.min(0.62, 0.22 + a * 0.14) }} />}
                {isCur && (
                  <>
                    <span className={`pointer-events-none absolute left-3 top-2.5 flex items-center gap-1.5 text-[9px] font-semibold text-white ${MONO}`} style={{ textShadow: "0 1px 3px rgb(0 0 0 / .7)" }}>
                      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--accent)" }} />{it.label}
                    </span>
                    <span className={`pointer-events-none absolute bottom-2.5 left-3 max-w-[60%] truncate text-[9px] font-semibold text-white ${MONO}`} style={{ textShadow: "0 1px 3px rgb(0 0 0 / .7)" }}>
                      {it.name}{isApplied && <span className="opacity-70"> · actuel</span>}
                    </span>
                  </>
                )}
                {!isCur && isApplied && (
                  <span className="pointer-events-none absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full" style={{ background: "var(--accent)", color: "var(--accent-fg)" }}><Check size={10} /></span>
                )}
              </button>
              {isCur && !isApplied && (
                <button type="button" onClick={() => apply(it)}
                  className="absolute bottom-2 right-2.5 flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold shadow-lg transition-opacity hover:opacity-90"
                  style={{ background: "var(--accent)", color: "var(--accent-fg)" }}>Appliquer</button>
              )}
              {isCur && isApplied && (
                <span className="pointer-events-none absolute bottom-2 right-2.5 flex h-5 w-5 items-center justify-center rounded-full" style={{ background: "var(--accent)", color: "var(--accent-fg)" }}><Check size={12} /></span>
              )}
              {isCur && it.onRemove && (
                <button type="button" aria-label={`Supprimer ${it.name}`} title="Retirer de ma collection" onClick={it.onRemove}
                  className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-red-600"><X size={12} /></button>
              )}
            </div>
          );
        })}
        {items.length > 1 && (
          <>
            <button type="button" tabIndex={-1} aria-label="Fond précédent" onClick={() => go(-1)} disabled={cur === 0}
              className="absolute left-2 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full transition-opacity hover:bg-white/10 disabled:opacity-20"
              style={{ background: "var(--surface-3)" }}><ChevronLeft size={16} /></button>
            <button type="button" tabIndex={-1} aria-label="Fond suivant" onClick={() => go(1)} disabled={cur === items.length - 1}
              className="absolute right-2 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full transition-opacity hover:bg-white/10 disabled:opacity-20"
              style={{ background: "var(--surface-3)" }}><ChevronRight size={16} /></button>
          </>
        )}
      </div>

      {/* Titre · transition · aide clavier */}
      <div className="flex flex-col items-center gap-3 px-4 pb-4">
        <div className="h-5 max-w-full truncate text-[15px] font-semibold">{item?.name ?? ""}</div>
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
          <span className={`text-[10px] mono-dim ${MONO}`}>Transition</span>
          <Segmented label="Effet de transition entre deux fonds" value={transition} onChange={onTransition} options={TRANSITIONS} />
        </div>
        <p className={`text-center text-[9.5px] leading-relaxed mono-dim ${MONO}`}>
          ← → parcourir · ↑ ↓ catégorie · entrée appliquer
        </p>
      </div>
    </div>
  );
}
