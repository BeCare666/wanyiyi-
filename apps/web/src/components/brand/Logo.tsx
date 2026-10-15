import { cn } from "@/lib/cn";

type LogoSize = "md" | "lg";

type LogoProps = {
  variant?: "horizontal" | "stacked";
  size?: LogoSize;
  className?: string;
  /** Masque le mot-symbole (emblème seul, par exemple pour une icône). */
  emblemOnly?: boolean;
};

/**
 * Logo validé : proposition C, deux anneaux entrelacés.
 * Anneau gauche en couleur de texte, anneau droit en couleur d'accent.
 * L'entrelacement est obtenu en redessinant l'arc inférieur de l'anneau droit
 * par-dessus l'anneau gauche, avec une réserve de la couleur du fond.
 * Le trait suit la taille de l'emblème (environ 1,8 px dans l'en-tête) pour rester net.
 */
export function LogoEmblem({ className }: { className?: string }) {
  const stroke = 3;
  return (
    <svg
      viewBox="16 6 68 48"
      className={cn("h-full w-auto", className)}
      shapeRendering="geometricPrecision"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="60" cy="30" r="22" fill="none" stroke="var(--accent)" strokeWidth={stroke} />
      <circle cx="40" cy="30" r="22" fill="none" stroke="currentColor" strokeWidth={stroke} />
      {/* Réserve, puis arc de l'anneau droit repassé devant l'anneau gauche */}
      <path d={interlaceArc} fill="none" stroke="var(--logo-bg, var(--bg))" strokeWidth={stroke + 3.5} />
      <path d={interlaceArc} fill="none" stroke="var(--accent)" strokeWidth={stroke} />
    </svg>
  );
}

// Arc bas-gauche de l'anneau droit (centre 60,30, rayon 22), géométrie du logo validé
const interlaceArc = "M56.18 51.67 A22 22 0 0 1 44.72 45.83";

const sizes: Record<LogoSize, { emblem: string; word: string; gap: string }> = {
  md: {
    emblem: "h-6 sm:h-7 lg:h-9",
    word: "text-[1.45rem] sm:text-[1.7rem] lg:text-[2.05rem]",
    gap: "gap-2 sm:gap-2.5 lg:gap-3",
  },
  lg: { emblem: "h-10", word: "text-[2.4rem]", gap: "gap-3.5" },
};

export function Logo({ variant = "horizontal", size = "md", className, emblemOnly }: LogoProps) {
  if (emblemOnly) return <LogoEmblem className={className} />;

  if (variant === "stacked") {
    return (
      <span className={cn("inline-flex flex-col items-center gap-3", className)}>
        <span className="h-14">
          <LogoEmblem />
        </span>
        <Wordmark className="text-[2.6rem]" />
      </span>
    );
  }

  const s = sizes[size];
  return (
    <span className={cn("inline-flex items-center", s.gap, className)}>
      <span className={s.emblem}>
        <LogoEmblem />
      </span>
      <Wordmark className={s.word} />
    </span>
  );
}

/** Mot-symbole : EB Garamond italique, graisse 500 pour rester lisible à petite taille. */
function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-serif font-medium italic leading-none tracking-[0.01em]", className)}>wanyiyi</span>
  );
}
