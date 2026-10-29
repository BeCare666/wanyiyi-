import Image, { type ImageProps } from "next/image";

/**
 * Image qui se rapproche très légèrement à l'apparition (transform uniquement, classe .slow-zoom).
 * Pas de fondu : l'image reste visible dès le premier affichage (LCP). L'animation est en CSS
 * pour démarrer au premier affichage, sans attendre le chargement de React sur mobile.
 */
export function SlowZoomImage({ className, alt, ...props }: ImageProps) {
  return (
    <div className="slow-zoom absolute inset-0">
      <Image {...props} alt={alt} fill className={className} />
    </div>
  );
}
