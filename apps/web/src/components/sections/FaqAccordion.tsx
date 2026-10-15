"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { PlusIcon } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { durations, easeSoft } from "@/lib/motion";

type Item = { q: string; a: string };

/**
 * Accordéon : la réponse apparaît en fondu avec un léger glissement,
 * l'icône tourne d'un quart de tour. Seuls transform et opacity sont animés.
 */
export function FaqAccordion({ items }: { items: Item[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const reduce = useReducedMotion();
  const baseId = useId();
  const transition = { duration: reduce ? 0 : durations.base, ease: easeSoft };

  return (
    <ul className="border-t border-line">
      {items.map((item, i) => {
        const open = openIndex === i;
        const buttonId = `${baseId}-q-${i}`;
        const panelId = `${baseId}-a-${i}`;
        return (
          <li key={item.q} className="border-b border-line">
            <h3>
              <button
                id={buttonId}
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpenIndex(open ? null : i)}
                className="flex w-full items-center justify-between gap-6 py-7 text-left font-serif text-xl md:text-2xl"
              >
                {item.q}
                <motion.span
                  aria-hidden="true"
                  className="shrink-0 text-accent"
                  animate={{ rotate: open ? 45 : 0 }}
                  transition={transition}
                >
                  <PlusIcon size={22} weight="light" />
                </motion.span>
              </button>
            </h3>
            <AnimatePresence initial={false}>
              {open && (
                <motion.div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  initial={{ opacity: 0, y: reduce ? 0 : -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={transition}
                >
                  <p className="max-w-2xl pb-8 text-fg-muted">{item.a}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </li>
        );
      })}
    </ul>
  );
}
