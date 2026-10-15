import { useTranslations } from "next-intl";
import Image from "next/image";
import { Reveal } from "@/components/motion/Reveal";
import { cn } from "@/lib/cn";

type Props = {
  src: string;
  alt: string;
  credit: string;
  sizes: string;
  /** Classes du cadre : proportions (aspect-*) et position collante éventuelle. */
  frameClassName?: string;
  /** Classes de l'image : cadrage (object-*). */
  imageClassName?: string;
  className?: string;
  /** Légende à gauche (lieu, numéro de planche), le crédit restant à droite. */
  caption?: string;
};

/**
 * Photo en pleine page de magazine : cadre sans arrondi, léger rapprochement à l'apparition
 * puis au survol (transform uniquement), tonalité légèrement adoucie, légende et crédit.
 */
export function EditorialImage({ src, alt, credit, sizes, frameClassName, imageClassName, className, caption }: Props) {
  const t = useTranslations("Common");
  return (
    <Reveal className={className}>
      <figure>
        <div className={cn("group relative overflow-hidden bg-stone-200", frameClassName)}>
          <div className="reveal-zoom absolute inset-0">
            <Image
              src={src}
              alt={alt}
              fill
              sizes={sizes}
              quality={75}
              className={cn(
                "photo-tone object-cover transition-transform duration-1000 ease-soft group-hover:scale-[1.025]",
                imageClassName,
              )}
            />
          </div>
        </div>
        <figcaption className="mt-3 flex items-baseline justify-between gap-4 text-[0.6875rem] uppercase tracking-[0.16em] text-fg-muted">
          <span>{caption}</span>
          <span className="normal-case tracking-normal italic">{t("photoCredit", { name: credit })}</span>
        </figcaption>
      </figure>
    </Reveal>
  );
}
