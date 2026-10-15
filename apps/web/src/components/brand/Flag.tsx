import { useId } from "react";
import { cn } from "@/lib/cn";

/**
 * Drapeaux des langues, dessinés en SVG.
 * Les émojis de drapeau ne s'affichent pas sous Windows (lettres « FR » à la place).
 * Français : France. Anglais : Royaume-Uni. Yoruba : Bénin (validé le 14 octobre 2026).
 * Les couleurs sont celles des drapeaux officiels, pas des jetons de marque.
 */
export function Flag({ locale, className }: { locale: string; className?: string }) {
  const uid = useId().replace(/:/g, "");
  const box = cn("block aspect-[3/2] h-auto w-5 shrink-0 overflow-hidden rounded-[1px] ring-1 ring-ink/12", className);

  if (locale === "fr") {
    return (
      <svg viewBox="0 0 3 2" className={box} aria-hidden="true" focusable="false">
        <rect width="1" height="2" fill="#002654" />
        <rect x="1" width="1" height="2" fill="#ffffff" />
        <rect x="2" width="1" height="2" fill="#ce1126" />
      </svg>
    );
  }

  if (locale === "en") {
    return (
      <svg viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice" className={box} aria-hidden="true" focusable="false">
        <clipPath id={`${uid}s`}>
          <path d="M0 0v30h60V0z" />
        </clipPath>
        <clipPath id={`${uid}t`}>
          <path d="M30 15h30v15zv15H0zH0V0zV0h30z" />
        </clipPath>
        <g clipPath={`url(#${uid}s)`}>
          <path d="M0 0v30h60V0z" fill="#012169" />
          <path d="M0 0l60 30m0-30L0 30" stroke="#ffffff" strokeWidth="6" />
          <path d="M0 0l60 30m0-30L0 30" clipPath={`url(#${uid}t)`} stroke="#c8102e" strokeWidth="4" />
          <path d="M30 0v30M0 15h60" stroke="#ffffff" strokeWidth="10" />
          <path d="M30 0v30M0 15h60" stroke="#c8102e" strokeWidth="6" />
        </g>
      </svg>
    );
  }

  // Yoruba : drapeau du Bénin
  return (
    <svg viewBox="0 0 15 10" className={box} aria-hidden="true" focusable="false">
      <rect width="15" height="10" fill="#e8112d" />
      <rect width="15" height="5" fill="#fcd116" />
      <rect width="6" height="10" fill="#008751" />
    </svg>
  );
}
