import type { CSSProperties, ReactNode } from "react";

type RevealProps = {
  children: ReactNode;
  className?: string;
  /** Délai en secondes, pour décaler les éléments d'une liste. */
  delay?: number;
  as?: "div" | "li" | "section" | "article";
};

/**
 * Apparition au défilement : fondu et léger glissement (transform et opacity uniquement).
 *
 * Amélioration progressive : le contenu est visible dans le HTML du serveur.
 * Il n'est masqué que lorsque le script de RevealScript a marqué la page (html[data-js])
 * et il réapparaît dès qu'il entre à l'écran. Sans JavaScript, tout reste lisible.
 */
export function Reveal({ children, className, delay = 0, as: Component = "div" }: RevealProps) {
  const style = delay ? ({ "--reveal-delay": `${delay}s` } as CSSProperties) : undefined;
  return (
    // data-revealed est posé par RevealScript avant l'hydratation : écart attendu, non signalé
    <Component data-reveal="" className={className} style={style} suppressHydrationWarning>
      {children}
    </Component>
  );
}
