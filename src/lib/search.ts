// Outils de la recherche d'applications (fenêtre Recherche) et de ses réglages

export const USAGE_KEY = "halo.search.usage";

/** Sans accents, minuscules, espaces simplifiés */
export const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Pertinence d'un nom pour ce qu'on a tapé : accents ignorés, début de mot, initiales, lettres dans l'ordre */
export function score(name: string, q: string): number {
  if (!q) return 0;
  if (name === q) return 100;
  if (name.startsWith(q)) return 90;
  const words = name.split(/[\s\-_.()]+/).filter(Boolean);
  if (words.some((w) => w.startsWith(q))) return 75;
  const i = name.indexOf(q);
  if (i >= 0) return 60 - Math.min(i, 20) * 0.5;
  const tokens = q.split(" ");
  if (tokens.length > 1 && tokens.every((t) => name.includes(t))) return 55;
  if (q.length >= 2 && words.map((w) => w[0]).join("").startsWith(q)) return 50;   // "vsc" → Visual Studio Code
  if (q.length >= 3) { let j = 0; for (const c of name) if (c === q[j]) j++; if (j === q.length) return 30; }
  return 0;
}

export function readUsage(): Record<string, number> {
  try { const v = JSON.parse(localStorage.getItem(USAGE_KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}
export function bumpUsage(target: string) {
  try { const u = readUsage(); u[target] = (u[target] ?? 0) + 1; localStorage.setItem(USAGE_KEY, JSON.stringify(u)); } catch { /* ignore */ }
}
export function clearUsage() {
  try { localStorage.removeItem(USAGE_KEY); } catch { /* ignore */ }
}

const TLD = "com|fr|org|net|io|dev|app|eu|tv|gg|ai|co|be|ch|ca|uk|de|es|it";
export const looksLikeUrl = (q: string) =>
  /^https?:\/\/\S+$/i.test(q) || /^www\.\S+\.\S+$/i.test(q) || new RegExp(`^[\\w-]+(\\.[\\w-]+)*\\.(${TLD})(/\\S*)?$`, "i").test(q);

// ───────────── Calculatrice (analyse maison : jamais d'eval) ─────────────
const FUNCS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, ln: Math.log, log: Math.log10, exp: Math.exp,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

/** Résultat d'une opération saisie (« 12*3,5 », « (2+3)^2 », « sqrt(81) », « 20% »), ou null si ce n'est pas un calcul */
export function calc(input: string): { value: number; text: string } | null {
  const src = input.toLowerCase().replace(/,/g, ".").replace(/×/g, "*").replace(/÷/g, "/").replace(/(\d)\s*x\s*(?=[\d(.])/g, "$1*").replace(/\s+/g, "");
  if (!src || !/^[\d.+\-*/^%()a-z]+$/.test(src)) return null;
  // Un simple nombre, ou du texte sans opération, n'est pas un calcul
  if (!/[+\-*/^%]|[a-z]+\(/.test(src.replace(/^-/, ""))) return null;
  let i = 0;
  const peek = () => src[i];
  const fail = (): never => { throw new Error("calc"); };

  function number(): number {
    const m = /^\d*\.?\d+(e[+-]?\d+)?/.exec(src.slice(i)) ?? /^\d+\.?/.exec(src.slice(i));
    if (!m) return fail();
    i += m[0].length;
    return parseFloat(m[0]);
  }
  function atom(): number {
    const c = peek();
    if (c === "(") { i++; const v = sum(); if (peek() !== ")") fail(); i++; return v; }
    if (c && /[a-z]/.test(c)) {
      const m = /^[a-z]+/.exec(src.slice(i))![0];
      i += m.length;
      if (peek() === "(") { const f = FUNCS[m]; if (!f) return fail(); i++; const v = sum(); if (peek() !== ")") fail(); i++; return f(v); }
      if (m in CONSTS) return CONSTS[m];
      return fail();
    }
    return number();
  }
  function post(): number { let v = atom(); while (peek() === "%") { i++; v /= 100; } return v; }
  function pow(): number { const b = post(); if (peek() === "^") { i++; return Math.pow(b, unary()); } return b; }
  function unary(): number { if (peek() === "-") { i++; return -unary(); } if (peek() === "+") { i++; return unary(); } return pow(); }
  function prod(): number {
    let v = unary();
    for (;;) {
      const c = peek();
      if (c === "*") { i++; v *= unary(); } else if (c === "/") { i++; v /= unary(); } else return v;
    }
  }
  function sum(): number {
    let v = prod();
    for (;;) {
      const c = peek();
      if (c === "+") { i++; v += prod(); } else if (c === "-") { i++; v -= prod(); } else return v;
    }
  }
  try {
    const v = sum();
    if (i !== src.length || !Number.isFinite(v)) return null;
    const r = Math.abs(v) < 1e15 ? Math.round(v * 1e10) / 1e10 : v; // 0,1 + 0,2 → 0,3
    return { value: r, text: r.toLocaleString("fr-FR", { maximumFractionDigits: 10 }) };
  } catch { return null; }
}
