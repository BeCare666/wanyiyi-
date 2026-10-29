"use client";

import { PlusIcon } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import { durations } from "@/lib/motion";
import { usePresence } from "@/lib/usePresence";

type Item = { q: string; a: string };

/**
 * Accordéon : la réponse apparaît en fondu avec un léger glissement,
 * l'icône tourne d'un quart de tour. Seuls transform et opacity sont animés.
 */
export function FaqAccordion({ items }: { items: Item[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const baseId = useId();

  return (
    <ul className="border-t border-line">
      {items.map((item, i) => (
        <FaqItem
          key={item.q}
          item={item}
          id={`${baseId}-${i}`}
          open={openIndex === i}
          onToggle={() => setOpenIndex(openIndex === i ? null : i)}
        />
      ))}
    </ul>
  );
}

function FaqItem({ item, id, open, onToggle }: { item: Item; id: string; open: boolean; onToggle: () => void }) {
  const { mounted, visible } = usePresence(open, durations.base * 1000);
  const buttonId = `${id}-q`;
  const panelId = `${id}-a`;

  return (
    <li className="border-b border-line">
      <h3>
        <button
          id={buttonId}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex w-full items-center justify-between gap-6 py-7 text-left font-serif text-xl md:text-2xl"
        >
          {item.q}
          <span
            aria-hidden="true"
            className={cn("shrink-0 text-accent transition-transform duration-500 ease-soft", open && "rotate-45")}
          >
            <PlusIcon size={22} weight="light" />
          </span>
        </button>
      </h3>
      {/* Fermeture : fondu seul, la réponse quitte la page à la fin de la transition */}
      {mounted && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={buttonId}
          className={cn(
            "transition-[opacity,translate] duration-500 ease-soft",
            visible ? "translate-y-0 opacity-100" : cn("opacity-0", open && "-translate-y-2"),
          )}
        >
          <p className="max-w-2xl pb-8 text-fg-muted">{item.a}</p>
        </div>
      )}
    </li>
  );
}
