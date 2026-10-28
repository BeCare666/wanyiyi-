import { SealCheckIcon } from "@phosphor-icons/react/ssr";
import { getTranslations } from "next-intl/server";

/** Badges de confiance connus (phase 4, question 5 a), dans l'ordre d'affichage. */
export const trustBadges = ["identity_verified", "evenings_attended", "profile_complete", "sponsor"] as const;
export type TrustBadge = (typeof trustBadges)[number];

/** Badges reçus de app.badges_of, connus et dans l'ordre ; les autres sont ignorés. */
export function knownBadges(raw: unknown): TrustBadge[] {
  const list = Array.isArray(raw) ? raw : [];
  return trustBadges.filter((b) => list.includes(b));
}

/**
 * Badges de confiance d'un membre (question 5) : attribués automatiquement par la base, montrés
 * au membre, à ses matchs et découvertes, à son couple et à son conseiller (jamais sur la vitrine).
 */
export async function TrustBadges({ badges, label }: { badges: unknown; label: string }) {
  const t = await getTranslations("Member.badges");
  const list = knownBadges(badges);
  if (list.length === 0) return null;
  return (
    <ul aria-label={label} className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
      {list.map((b) => (
        <li key={b} className="inline-flex items-center gap-2">
          <SealCheckIcon size={18} weight="light" aria-hidden="true" className="text-accent" />
          {t(b)}
        </li>
      ))}
    </ul>
  );
}
