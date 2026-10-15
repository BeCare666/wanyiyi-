import { getTranslations } from "next-intl/server";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";

export type Testimonial = { id: string; quote: string; signature: string };

/**
 * Témoignages : emplacement prévu, masqué tant qu'aucun témoignage réel et autorisé n'existe.
 * La source sera la table des contenus de la vitrine (phase 2, module administration).
 */
export async function Testimonials({ items = [] }: { items?: Testimonial[] }) {
  if (items.length === 0) return null;
  const t = await getTranslations("Testimonials");

  return (
    <section aria-labelledby="testimonials-title" className="border-t border-line py-section">
      <Container>
        <SectionHeading id="testimonials-title" eyebrow={t("eyebrow")} title={t("title")} />
        <ul className="mt-14 grid gap-12 md:grid-cols-2">
          {items.map((item) => (
            <li key={item.id} className="border-t border-line pt-8">
              <blockquote className="font-serif text-2xl italic leading-snug">{item.quote}</blockquote>
              <p className="eyebrow mt-6">{item.signature}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
