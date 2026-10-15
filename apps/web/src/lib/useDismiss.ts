"use client";

import { type RefObject, useEffect } from "react";

/**
 * Ferme un panneau ouvert : toucher ou clic en dehors de `ref`, ou touche Échap.
 * `onClose(true)` signale une fermeture au clavier (le focus doit revenir au bouton).
 */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onClose: (fromKeyboard: boolean) => void) {
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(true);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, open, onClose]);
}
