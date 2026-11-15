import { hexToHsl, hsl, rgbToHex } from "./color";

/** Couleurs dérivées d'une pochette : fond en dégradé, accent, texte */
export interface Palette {
  c1: string; c2: string; c3: string;   // fond (coin clair, base sombre, coin opposé)
  accent: string; accentFg: string;     // barre de progression, bouton lecture (+ texte lisible dessus)
  glow: string;                         // ombre colorée sous la pochette
  fg: string; fgDim: string;            // texte principal / secondaire
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Teinte (h, s en %) → palette sombre teintée : le texte blanc reste lisible quelle que soit la pochette */
export function makePalette(h1: number, s1: number, h2: number, s2: number, neutral = false): Palette {
  h1 = Math.round(h1); h2 = Math.round(h2); s1 = Math.round(s1); s2 = Math.round(s2);
  const lo = neutral ? 0 : 28;
  return {
    c1: hsl(h1, clamp(s1, lo, 78), neutral ? 27 : 31),
    c2: hsl(h2, clamp(s2, lo, 60), neutral ? 11 : 13),
    c3: hsl(h2, clamp(s2, lo, 72), neutral ? 20 : 25),
    accent: neutral ? hsl(h1, 0, 92) : hsl(h1, clamp(s1, 55, 95), 69),
    accentFg: "#111214",
    glow: hsl(h1, neutral ? 0 : clamp(s1, 40, 90), neutral ? 60 : 46, neutral ? 0.25 : 0.55),
    fg: "#ffffff",
    fgDim: "rgba(255,255,255,.68)",
  };
}

/** Palette neutre (aucune pochette) : graphite + vert Spotify */
export const DEFAULT_PALETTE: Palette = {
  ...makePalette(210, 6, 210, 6, true),
  accent: "#1db954",
  glow: "rgba(0,0,0,.35)",
};

const BINS = 24; // un seau tous les 15° de teinte

/**
 * Cherche les deux teintes dominantes d'une image (RGBA, ex. 40×40 px).
 * Les pixels très sombres, très clairs ou ternes pèsent peu : on garde la couleur qui "fait" la pochette.
 */
export function paletteFromPixels(d: ArrayLike<number>): Palette {
  const w = new Float64Array(BINS), sr = new Float64Array(BINS), sg = new Float64Array(BINS), sb = new Float64Array(BINS);
  let n = 0, totalW = 0, mr = 0, mg = 0, mb = 0;

  for (let i = 0; i + 3 < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
    const l = (mx + mn) / 510;
    const mid = 1 - Math.abs(2 * l - 1);                      // 0 = noir ou blanc, 1 = milieu
    const s = c === 0 ? 0 : Math.min(1, c / 255 / (mid + 1e-6));
    n++; mr += r; mg += g; mb += b;
    if (s < 0.1 || mid < 0.08) continue;                      // gris, noir, blanc : pas de teinte exploitable
    let h = 0;
    if (mx === r) h = ((g - b) / c) % 6; else if (mx === g) h = (b - r) / c + 2; else h = (r - g) / c + 4;
    h *= 60; if (h < 0) h += 360;
    const k = Math.min(BINS - 1, Math.floor(h / (360 / BINS)));
    const wt = (0.02 + s * s) * mid;
    w[k] += wt; sr[k] += r * wt; sg[k] += g * wt; sb[k] += b * wt; totalW += wt;
  }

  if (!n) return DEFAULT_PALETTE;

  // Image presque sans couleur (noir & blanc, gris) : fond neutre, léger reflet de la teinte moyenne
  if (totalW / n < 0.012) {
    const [h] = hexToHsl(rgbToHex(mr / n, mg / n, mb / n));
    return makePalette(h, 0, h, 0, true);
  }

  // Un même ton peut être coupé entre deux seaux voisins : on lisse avant de choisir
  const score = (i: number) => w[i] + 0.5 * (w[(i + BINS - 1) % BINS] + w[(i + 1) % BINS]);
  let p = 0;
  for (let i = 1; i < BINS; i++) if (score(i) > score(p)) p = i;

  const colorOf = (i: number): [number, number] => {
    const idx = [i, (i + BINS - 1) % BINS, (i + 1) % BINS];
    let r = 0, g = 0, b = 0, ww = 0;
    for (const j of idx) { r += sr[j]; g += sg[j]; b += sb[j]; ww += w[j]; }
    const [h, s] = hexToHsl(rgbToHex(r / ww, g / ww, b / ww));
    return [h, s];
  };

  const [h1, s1] = colorOf(p);

  // Deuxième teinte : au moins 45° plus loin et assez présente, sinon un voisin de teinte
  let q = -1;
  for (let i = 0; i < BINS; i++) {
    const dist = Math.min((i - p + BINS) % BINS, (p - i + BINS) % BINS);
    if (dist < 3 || w[i] < 0.2 * score(p)) continue;
    if (q < 0 || score(i) > score(q)) q = i;
  }
  const [h2, s2] = q >= 0 ? colorOf(q) : [h1 + 28, s1 * 0.8];

  return makePalette(h1, s1, h2, s2);
}
