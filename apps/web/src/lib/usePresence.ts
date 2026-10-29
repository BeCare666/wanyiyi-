"use client";

import { useEffect, useState } from "react";

/**
 * Apparition et disparition animées d'un panneau, sans bibliothèque d'animation.
 * - `mounted` : le panneau est dans la page (ouvert, ou en train de se fermer).
 * - `visible` : état visuel ; il passe à vrai deux images après l'ouverture, pour que la
 *   transition CSS (opacity, transform) parte de l'état fermé.
 * À la fermeture, le panneau reste monté `durationMs` le temps de sa transition de sortie.
 */
export function usePresence(open: boolean, durationMs: number) {
  // Vrai depuis l'apparition jusqu'à la fin de la transition de sortie
  const [shown, setShown] = useState(open);
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    if (open) {
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => {
          setShown(true);
          setVisible(true);
        });
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }
    const frame = requestAnimationFrame(() => setVisible(false));
    const timer = setTimeout(() => setShown(false), durationMs);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [open, durationMs]);

  return { mounted: open || shown, visible };
}
