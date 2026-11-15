import { useEffect, useRef } from "react";
import { Headphones, Volume1, Volume2, VolumeX } from "lucide-react";
import { audioBus, audioLevel, setVolume, toggleMute, useAudioDevices, useMeterSync, useVolume } from "../../lib/sys";
import { useSettings } from "../../lib/settings";
import { asBg, Surface, type WProps } from "./common";

const HIST = 64;
const hash = (i: number) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

type Mode = "disc" | "bars" | "ring";

/** Indicateur de son : réagit au niveau réel de la sortie audio Windows (pic crête) ; la sortie (casque, enceintes…) se choisit dans les options du widget */
export function SoundWidget({ opts, edit }: WProps) {
  const mode = ((opts.style as string) ?? "disc") as Mode;
  const useAccent = opts.color === "accent";
  const interactive = opts.interactive !== false && !edit;
  const bg = asBg(opts.bg, "glass");
  const followOutput = opts.follow === true;
  const showOutput = opts.showOutput !== false;
  const vol = useVolume();
  const dev = useAudioDevices();
  useMeterSync(followOutput && !edit);
  const accent = useSettings((x) => x.accent);
  const theme = useSettings((x) => x.theme);
  const cv = useRef<HTMLCanvasElement>(null);
  const muted = useRef(vol.mute);
  muted.current = vol.mute || vol.vol === 0;

  const W = mode === "bars" ? 250 : 170, H = mode === "bars" ? 90 : 170;

  useEffect(() => {
    const c = cv.current!, g = c.getContext("2d")!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = W * dpr; c.height = H * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const col = useAccent ? css.getPropertyValue("--accent").trim() || "#e5484d" : css.getPropertyValue("--text").trim() || "#f1e6d2";

    const hist = new Array<number>(HIST).fill(0);
    let level = 0, t = 0, rot = 0, raf = 0, last = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 33 || document.hidden) return;
      last = now; t++;
      const raw = muted.current ? 0 : audioLevel(now);
      level += (raw - level) * (raw > level ? 0.6 : 0.14);
      hist.unshift(level); hist.length = HIST;
      g.clearRect(0, 0, W, H);
      g.fillStyle = col; g.strokeStyle = col; g.globalAlpha = muted.current ? 0.35 : 1;

      if (mode === "disc") {
        rot += 0.012 + level * 0.05;
        for (let r = 1; r <= 8; r++) {
          const n = 6 * r, amp = hist[Math.min(HIST - 1, r * 3)];
          for (let i = 0; i < n; i++) {
            const a = (i / n) * 6.283 + rot * (r % 2 ? 1 : -1);
            const idle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 0.06 + r * 0.8 + i * 0.4));
            const dist = r * 9.5 * (1 + 0.07 * amp);
            const size = 0.7 + 1.1 * idle + 3.4 * amp * (0.6 + 0.4 * Math.sin(i * 1.7 + r));
            g.globalAlpha = (muted.current ? 0.3 : 0.55 + 0.45 * Math.min(1, idle * 0.6 + amp));
            g.beginPath(); g.arc(W / 2 + Math.cos(a) * dist, H / 2 + Math.sin(a) * dist, size, 0, 7); g.fill();
          }
        }
      } else if (mode === "ring") {
        g.lineCap = "round";
        const N = 56;
        for (let i = 0; i < N; i++) {
          const a = (i / N) * 6.283 - 1.5708;
          const amp = hist[(i * 2) % HIST] * (0.55 + 0.45 * hash(i));
          const idle = 0.5 + 0.5 * Math.sin(t * 0.05 + i * 0.5);
          const len = 5 + idle * 3 + amp * 30;
          const r0 = 46;
          g.lineWidth = 2.6;
          g.globalAlpha = muted.current ? 0.3 : 0.5 + 0.5 * Math.min(1, amp * 1.4 + 0.2);
          g.beginPath();
          g.moveTo(W / 2 + Math.cos(a) * r0, H / 2 + Math.sin(a) * r0);
          g.lineTo(W / 2 + Math.cos(a) * (r0 + len), H / 2 + Math.sin(a) * (r0 + len));
          g.stroke();
        }
      } else {
        g.lineCap = "round";
        const N = 30, gap = (W - 40) / N;
        for (let i = 0; i < N; i++) {
          const amp = hist[(i * 2) % HIST] * (0.55 + 0.45 * hash(i + 5));
          const idle = 0.5 + 0.5 * Math.sin(t * 0.05 + i * 0.55);
          const hgt = 5 + idle * 4 + amp * (H - 34);
          g.lineWidth = 4;
          g.globalAlpha = muted.current ? 0.3 : 0.55 + 0.45 * Math.min(1, amp * 1.3 + 0.2);
          const x = 20 + gap * (i + 0.5);
          g.beginPath(); g.moveTo(x, H / 2 - hgt / 2); g.lineTo(x, H / 2 + hgt / 2); g.stroke();
        }
      }
      g.globalAlpha = 1;
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [mode, useAccent, W, H, accent, theme]);

  const VIcon = vol.mute || vol.vol === 0 ? VolumeX : vol.vol < 0.4 ? Volume1 : Volume2;
  const shape = mode === "bars" ? "rounded-[var(--radius)]" : "rounded-full";
  const pad = mode === "bars" ? 0 : 10;

  return (
    <Surface bg={bg} label="Indicateur de son" className={`group relative ${shape}`}
      style={{ width: W + pad * 2, height: H + pad * 2 }}>
      <div
        onWheel={interactive ? (e) => setVolume(vol.vol + (e.deltaY < 0 ? 0.02 : -0.02)) : undefined}
        onClick={interactive ? toggleMute : undefined}
        title={interactive ? `Clic : muet · Molette : volume${dev.known && dev.selected ? ` · Sortie : ${dev.selected}` : ""}${audioBus.endpoints ? ` · ${followOutput ? "1 sortie suivie" : `${audioBus.endpoints} sortie(s) audio surveillée(s)`}` : ""}` : undefined}
        className={`flex h-full w-full items-center justify-center ${interactive ? "cursor-pointer" : ""}`}>
        <canvas ref={cv} style={{ width: W, height: H }} />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-2 flex flex-col items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {showOutput && dev.known && dev.selected && (
          <span className="glass glass-strong flex max-w-[86%] items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]">
            <Headphones size={12} className="shrink-0" /><span className="truncate">{dev.selected}</span>
          </span>
        )}
        <span className="glass glass-strong flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] tabular-nums">
          <VIcon size={12} />{vol.ok ? `${vol.mute ? 0 : Math.round(vol.vol * 100)}%` : "—"}
        </span>
      </div>
    </Surface>
  );
}
