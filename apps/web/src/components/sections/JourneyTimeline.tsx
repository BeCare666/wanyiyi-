"use client";

import { useEffect, useRef } from "react";
import { Reveal } from "@/components/motion/Reveal";

type Step = { title: string; text: string };

/**
 * Ligne de temps : un filet vertical se dessine au défilement (scaleY),
 * chaque étape apparaît en fondu. Sur mobile, la ligne reste à gauche.
 */
export function JourneyTimeline({ steps }: { steps: Step[] }) {
  const ref = useRef<HTMLOListElement>(null);
  const lineRef = useRef<HTMLSpanElement>(null);

  // Progression : 0 quand le haut de la liste atteint 75 % de l'écran, 1 quand son bas atteint 60 %.
  // Le style est posé directement (pas de nouveau rendu React à chaque défilement).
  useEffect(() => {
    const list = ref.current;
    const line = lineRef.current;
    if (!list || !line) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      line.style.transform = "scaleY(1)";
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const vh = window.innerHeight;
      const { top, height } = list.getBoundingClientRect();
      const progress = Math.min(1, Math.max(0, (0.75 * vh - top) / (height + 0.15 * vh)));
      line.style.transform = `scaleY(${progress})`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return (
    <ol ref={ref} className="relative mt-16 lg:mt-24">
      <span aria-hidden="true" className="absolute left-[0.6875rem] top-2 bottom-2 w-px bg-line md:left-1/2" />
      {/* Lissage du suivi du défilement : courte transition sur transform */}
      <span
        ref={lineRef}
        aria-hidden="true"
        className="absolute left-[0.6875rem] top-2 bottom-2 w-px origin-top bg-accent transition-transform duration-300 ease-soft md:left-1/2"
        style={{ transform: "scaleY(0)" }}
      />
      {steps.map((step, i) => {
        const right = i % 2 === 1;
        return (
          <Reveal
            as="li"
            key={step.title}
            className="relative grid grid-cols-[1.5rem_1fr] gap-6 pb-14 last:pb-0 md:grid-cols-[1fr_3rem_1fr] md:gap-0 md:pb-20"
          >
            <span aria-hidden="true" className="relative z-10 mt-3 flex justify-center md:col-start-2">
              <span className="block size-3 rotate-45 border border-accent bg-bg-soft" />
            </span>
            <div className={right ? "md:col-start-3 md:pl-12" : "md:col-start-1 md:row-start-1 md:pr-12 md:text-right"}>
              <p className="font-serif text-lg italic text-fg-muted">{String(i + 1).padStart(2, "0")}</p>
              <h3 className="mt-2 text-2xl md:text-3xl">{step.title}</h3>
              <p className={`mt-4 max-w-md text-fg-muted ${right ? "" : "md:ml-auto"}`}>{step.text}</p>
            </div>
          </Reveal>
        );
      })}
    </ol>
  );
}
