import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { coupleSpace } from "@/components/member/memberNav";
import { Link } from "@/i18n/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { canAskExtension, canChoose, daysLeft, type DiscoveryRow, groupBySection } from "./discoveries";
import { ChooseMatch, DiscoveryDecisions } from "./DiscoveryActions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Member.matches");
  return { title: t("title") };
}

/**
 * Mes matchs et découvertes (section 9.4 ; question 2 de la phase 3) : matchs à choisir, matchs en
 * attente de l'autre, découvertes ouvertes (14 jours, une prolongation), couple, mises en relation
 * terminées. Lecture avec le jeton du membre (app.my_discoveries) : prénom de l'autre seulement,
 * jamais son choix ni sa décision.
 */
export default async function MatchesPage() {
  const t = await getTranslations("Member");
  const format = await getFormatter();
  const supabase = await createSupabaseServer();
  const result = supabase ? await supabase.rpc("my_discoveries") : null;
  const rows = (result?.data ?? []) as DiscoveryRow[];
  const now = new Date();
  const sections = groupBySection(rows, now);
  const slots = rows[0]?.free_slots ?? 2;
  const day = (iso: string) => format.dateTime(new Date(iso), "eventDay");

  return (
    <div className="mx-auto max-w-5xl">
      <header>
        <p className="eyebrow flex items-center gap-4">
          <span aria-hidden="true" className="block h-px w-10 bg-accent" />
          {t("nav.matches")}
        </p>
        <h1 className="mt-6 text-4xl">{t("matches.title")}</h1>
        <p className="mt-6 max-w-measure text-lg text-fg-muted">{t("discoveries.intro")}</p>
      </header>

      {!result || result.error ? (
        <p role="alert" className="mt-14 border-l border-accent pl-5 text-fg-muted">
          {t("errors.unavailable")}
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-14 border-t border-line pt-8 text-fg-muted">{t("matches.empty")}</p>
      ) : (
        <>
          {sections.active.length > 0 && (
            <section aria-labelledby="decouvertes" className="mt-14">
              <h2 id="decouvertes" className="eyebrow">
                {t("discoveries.active")}
              </h2>
              <ol className="mt-4 border-t border-line">
                {sections.active.map((row) => (
                  <li key={row.match_id} className="border-b border-line py-7">
                    <div className="flex flex-wrap items-baseline justify-between gap-4">
                      <p className="font-serif text-3xl">{row.partner_first_name}</p>
                      <p className="text-sm text-fg-muted">
                        {t("discoveries.daysLeft", { count: daysLeft(row.ends_at!, now), date: day(row.ends_at!) })}
                        {row.extended && ` · ${t("discoveries.extended")}`}
                      </p>
                    </div>
                    <Link
                      href={`/espace/matchs/${row.discovery_id}`}
                      className="mt-4 inline-flex min-h-12 items-center text-link underline-offset-4 hover:underline"
                    >
                      {t("discoveries.open")}
                    </Link>
                    <DiscoveryDecisions
                      discoveryId={row.discovery_id!}
                      wantsToContinue={row.i_want_to_continue}
                      wantsExtension={row.i_want_extension}
                      canExtend={canAskExtension(row)}
                    />
                  </li>
                ))}
              </ol>
            </section>
          )}

          {sections.toChoose.length > 0 && (
            <section aria-labelledby="a-choisir" className="mt-14">
              <h2 id="a-choisir" className="eyebrow">
                {t("discoveries.toChoose")}
              </h2>
              <p className="mt-3 max-w-measure text-sm text-fg-muted">
                {slots > 0 ? t("discoveries.slots", { count: slots }) : t("discoveries.noSlot")}
              </p>
              <ol className="mt-4 border-t border-line">
                {sections.toChoose.map((row) => (
                  <li key={row.match_id} className="grid gap-3 border-b border-line py-7 md:grid-cols-12 md:items-center md:gap-8">
                    <p className="font-serif text-3xl md:col-span-5">{row.partner_first_name}</p>
                    <p className="text-sm text-fg-muted md:col-span-4">{t("discoveries.chooseBefore", { date: day(row.pending_expires_at) })}</p>
                    <div className="md:col-span-3 md:text-right">
                      <ChooseMatch matchId={row.match_id} disabled={!canChoose(row)} />
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {sections.waiting.length > 0 && (
            <section aria-labelledby="en-attente" className="mt-14">
              <h2 id="en-attente" className="eyebrow">
                {t("discoveries.waiting")}
              </h2>
              <ol className="mt-4 border-t border-line">
                {sections.waiting.map((row) => (
                  <li key={row.match_id} className="grid gap-2 border-b border-line py-7 md:grid-cols-12 md:items-baseline md:gap-8">
                    <p className="font-serif text-3xl md:col-span-5">{row.partner_first_name}</p>
                    <p className="text-sm text-fg-muted md:col-span-7">{t("discoveries.waitingHelp", { date: day(row.pending_expires_at) })}</p>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {sections.couple.length > 0 && (
            <section aria-labelledby="couple" className="mt-14">
              <h2 id="couple" className="eyebrow">
                {t("discoveries.couple")}
              </h2>
              <ol className="mt-4 border-t border-line">
                {sections.couple.map((row) => (
                  <li key={row.match_id} className="border-b border-line py-7">
                    <p className="font-serif text-3xl">{row.partner_first_name}</p>
                    <p className="mt-2 text-sm text-fg-muted">{t("discoveries.coupleHelp")}</p>
                    <Link href={coupleSpace} className="mt-4 inline-flex min-h-12 items-center text-link underline-offset-4 hover:underline">
                      {t("discoveries.coupleOpen")}
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {sections.ended.length > 0 && (
            <section aria-labelledby="terminees" className="mt-14">
              <h2 id="terminees" className="eyebrow">
                {t("discoveries.ended")}
              </h2>
              <ol className="mt-4 border-t border-line">
                {sections.ended.map((row) => (
                  <li key={row.match_id} className="grid gap-2 border-b border-line py-5 md:grid-cols-12 md:items-baseline md:gap-8">
                    <p className="text-lg md:col-span-5">{row.partner_first_name}</p>
                    <p className="text-sm text-fg-muted md:col-span-7">{t("discoveries.endedMessage")}</p>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}
    </div>
  );
}
