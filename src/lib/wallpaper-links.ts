// ════════════════════════════════════════════════════════════════════════════
//   MES FONDS D'ÉCRAN — colle tes liens ici
// ════════════════════════════════════════════════════════════════════════════
//
//  Chaque ligne ci-dessous est un emplacement prêt à remplir : mets simplement
//  l'adresse d'une image entre les guillemets de `url`. Les lignes dont `url`
//  est vide sont ignorées. Tu peux en ajouter autant que tu veux (copie une ligne).
//
//  Les fonds apparaissent dans  Réglages › Fond d'écran › « Ma collection ».
//  (On peut aussi coller un lien directement dans ce panneau, sans toucher au code.)
//
//  ► `url`   Lien DIRECT vers l'image (https://…). Astuce : clic droit sur l'image
//            dans ton navigateur › « Copier l'adresse de l'image ».
//            Exemples valides :  https://exemple.com/photo.jpg
//                                https://images.unsplash.com/photo-XXXX?w=2560&q=80&fm=jpg
//  ► `name`  Le nom affiché sous la vignette.
//  ► `tone`  "dark" si l'image est plutôt sombre (texte clair), "light" si elle est claire
//            (texte foncé pour l'horloge). Par défaut : "dark".
//  ► `thumb` (facultatif) Lien d'une version plus légère pour la vignette des Réglages.
//            Ex. le même lien Unsplash avec  ?w=480  — inutile si ton image est déjà petite.
//
//  Ensuite, relance simplement Halo (ou laisse `npm run tauri dev` recharger).
// ════════════════════════════════════════════════════════════════════════════

export interface WallpaperLink {
  name: string;
  url: string;
  tone?: "dark" | "light";
  thumb?: string;
}

export const WALLPAPER_LINKS: WallpaperLink[] = [
  // ↓↓↓ Remplis les `url` ↓↓↓
  { name: "Fond 1", url: "" },
  { name: "Fond 2", url: "" },
  { name: "Fond 3", url: "" },
  { name: "Fond 4", url: "" },
  { name: "Fond 5", url: "" },
  { name: "Fond 6", url: "" },
  { name: "Fond 7", url: "" },
  { name: "Fond 8", url: "" },
  { name: "Fond 9", url: "" },
  { name: "Fond 10", url: "" },
  { name: "Fond 11", url: "" },
  { name: "Fond 12", url: "" },
  // Exemple d'une ligne remplie (supprime les // pour l'utiliser) :
  // { name: "Montagnes", url: "https://images.unsplash.com/photo-XXXX?w=2560&q=80&fm=jpg", tone: "dark", thumb: "https://images.unsplash.com/photo-XXXX?w=480&q=70&fm=jpg" },
];

// ────────────────────────────────────────────────────────────────────────────
//  Le reste ne se modifie pas
// ────────────────────────────────────────────────────────────────────────────

export const isHttpUrl = (u: string) => /^https?:\/\/\S+$/i.test(u.trim());

/** Les lignes réellement remplies (url valide) */
export function configuredLinks(): WallpaperLink[] {
  return WALLPAPER_LINKS.filter((l) => isHttpUrl(l.url)).map((l) => ({ ...l, url: l.url.trim() }));
}

/** Identifiant d'un fond « lien » : "link:" + adresse (stable, même si tu réordonnes les lignes) */
export const linkId = (url: string) => "link:" + url;
export const linkUrl = (id: string) => id.slice(5);
