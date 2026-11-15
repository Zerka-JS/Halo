import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

// Vrai dans la fenêtre Tauri ; faux si on ouvre le front dans un navigateur (npm run dev seul)
export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** invoke() qui ne plante jamais : renvoie undefined en cas d'erreur ou hors Tauri */
export function call<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  if (!inTauri) return Promise.resolve(undefined);
  return invoke<T>(cmd, args).catch(() => undefined);
}

/** Écoute un évènement Tauri ; renvoie la fonction de désinscription */
export function on<T>(event: string, cb: (payload: T) => void): () => void {
  if (!inTauri) return () => {};
  let off: (() => void) | null = null;
  let dead = false;
  listen<T>(event, (e) => cb(e.payload))
    .then((f) => { if (dead) f(); else off = f; })
    .catch(() => {});
  return () => { dead = true; off?.(); };
}

export function send(event: string, payload?: unknown) {
  if (inTauri) emit(event, payload).catch(() => {});
}
