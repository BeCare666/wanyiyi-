import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary";

const variants: Record<Variant, { base: string; veil: string }> = {
  primary: { base: "bg-accent text-accent-fg", veil: "bg-ink/25" },
  secondary: { base: "border border-fg text-fg", veil: "bg-accent-soft/60" },
};

/**
 * Bouton de formulaire, même apparence que ButtonLink : voile au survol (opacity uniquement),
 * coins de 2 px, pas d'ombre. Désactivé : atténué, sans voile.
 */
export function Button({ variant = "primary", className, children, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  const v = variants[variant];
  return (
    <button
      {...props}
      className={cn(
        "group relative isolate inline-flex min-h-12 items-center justify-center gap-3 overflow-hidden rounded-sm px-7 text-xs font-medium uppercase tracking-[0.16em] disabled:cursor-not-allowed disabled:opacity-50",
        v.base,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-0 -z-10 opacity-0 transition-opacity duration-500 ease-soft group-enabled:group-hover:opacity-100 group-focus-visible:opacity-100",
          v.veil,
        )}
      />
      {children}
    </button>
  );
}

/** Champ de saisie : filet inférieur seulement, grande taille de texte (lisible sur mobile). */
export const fieldClass =
  "mt-3 block w-full rounded-none border-0 border-b border-line-strong bg-transparent px-0 py-3 text-xl text-fg placeholder:text-fg-muted/60 focus:border-fg focus:outline-none focus-visible:outline-none";
