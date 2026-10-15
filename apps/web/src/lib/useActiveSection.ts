"use client";

import { useEffect, useState } from "react";

/**
 * Section de la page d'accueil qui occupe le milieu de l'écran, ou null.
 * Sert à marquer l'entrée de menu correspondante pendant le défilement.
 */
export function useActiveSection(ids: readonly string[], enabled: boolean) {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join(",");

  useEffect(() => {
    if (!enabled) return;
    const elements = key
      .split(",")
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        // Ordre de la page : la première section visible l'emporte
        setActive(elements.find((el) => visible.has(el.id))?.id ?? null);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [key, enabled]);

  // Hors de la page d'accueil, aucune section n'est active
  return enabled ? active : null;
}
