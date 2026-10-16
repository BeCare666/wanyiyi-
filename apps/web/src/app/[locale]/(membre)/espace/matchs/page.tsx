import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { memberApi } from "@/lib/api";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Member.matches");
  return { title: t("title") };
}

/** Réponse de GET /matches : prénom de l'autre personne seulement (jamais son nom). */
type Match = {
  match_id: string;
  partner_first_name: string;
  announced_at: string;
  status: "pending_choice" | "discovery_open" | "expired" | "closed";
};

/**
 * Mes matchs (étape 4) : la liste, visible à partir de l'annonce de 8 h.
 * L'ouverture des découvertes (section 9.4) arrive avec la phase 3.
 */
export default async function MatchesPage() {
  const t = await getTranslations("Member");
  const format = await getFormatter();
  const result = await memberApi<Match[]>("/matches");

  return (
    <div className="mx-auto max-w-5xl">
      <header>
        <p className="eyebrow flex items-center gap-4">
          <span aria-hidden="true" className="block h-px w-10 bg-accent" />
          {t("nav.matches")}
        </p>
        <h1 className="mt-6 text-4xl">{t("matches.title")}</h1>
        <p className="mt-6 max-w-measure text-lg text-fg-muted">{t("matches.intro")}</p>
      </header>

      {!result.ok ? (
        <p role="alert" className="mt-14 border-l border-accent pl-5 text-fg-muted">
          {t(result.error === "unavailable" ? "errors.unavailable" : "errors.generic")}
        </p>
      ) : result.data.length === 0 ? (
        <p className="mt-14 border-t border-line pt-8 text-fg-muted">{t("matches.empty")}</p>
      ) : (
        <ol className="mt-14 border-t border-line">
          {result.data.map((match) => (
            <li key={match.match_id} className="grid gap-2 border-b border-line py-7 md:grid-cols-12 md:items-baseline md:gap-8">
              <p className="font-serif text-3xl md:col-span-5">{match.partner_first_name}</p>
              <p className="text-sm text-fg-muted md:col-span-4">
                {t("matches.announced", { date: format.dateTime(new Date(match.announced_at), "eventDay") })}
              </p>
              <p className="eyebrow md:col-span-3 md:text-right">{t(`matches.status.${match.status}`)}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
