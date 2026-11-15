import { useMemo } from "react";
import type { Transition } from "motion/react";
import { useSettings, type DockSpring } from "./settings";

/** Réglages de mouvement partagés par toutes les fenêtres (niveau, vitesse) */
export function useMotion() {
  const level = useSettings((s) => s.motion.level);
  const speed = useSettings((s) => s.motion.speed);
  return useMemo(() => {
    const off = level === "off", reduced = level === "reduced";
    const k = off ? 0 : reduced ? Math.max(speed, 1.4) : speed;
    return {
      level, speed, off, reduced,
      /** Durée en secondes, ajustée à la vitesse choisie (0 si animations coupées) */
      dur: (s: number) => (off ? 0 : s / k),
      /** Ressort adapté au niveau : instantané si coupé, sans rebond si réduit */
      spring: (stiffness = 300, damping = 26): Transition =>
        off ? { duration: 0 }
          : reduced ? { type: "spring", stiffness: stiffness * 1.6, damping: damping * 1.5 + 14 }
          : { type: "spring", stiffness: stiffness * speed * speed, damping: damping * speed },
    };
  }, [level, speed]);
}

/** Paramètres du ressort de la loupe du dock */
export function dockSpring(kind: DockSpring, level: "full" | "reduced" | "off", speed: number) {
  if (level === "off") return { mass: 0.1, stiffness: 1200, damping: 120 };
  if (level === "reduced") return { mass: 0.1, stiffness: 420, damping: 42 };
  const base = kind === "soft" ? { mass: 0.14, stiffness: 120, damping: 17 }
    : kind === "snappy" ? { mass: 0.08, stiffness: 260, damping: 21 }
    : { mass: 0.1, stiffness: 170, damping: 14 };
  return { mass: base.mass, stiffness: base.stiffness * speed * speed, damping: base.damping * speed };
}
