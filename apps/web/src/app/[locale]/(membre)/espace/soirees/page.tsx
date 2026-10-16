import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { memberNav } from "@/components/member/memberNav";
import { Link } from "@/i18n/navigation";
import { memberApi } from "@/lib/api";
import { cn } from "@/lib/cn";
import { getSessionMember } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { EveningActions } from "./EveningActions";
import {
  type Evening,
  eveningActions,
  eveningFilters,
  filterEvenings,
  freeSeats,
  groupByMonth,
  parseFilter,
  type Sex,
} from "./evenings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Member.evenings");
  return { title: t("title") };
}

type Props = { searchParams: Promise<{ filtre?: string | string[] }> };

/** Sexe (quotas séparés) et état de validation du membre, lus avec son jeton (RLS). */
async function memberProfile(userId: string): Promise<{ sex: Sex | null; verified: boolean }> {
  const supabase = await createSupabaseServer();
  const { data } = (await supabase?.from("member_profiles").select("sex, status").eq("user_id", userId).maybeSingle()) ?? { data: null };
  const sex = data?.sex === "female" || data?.sex === "male" ? data.sex : null;
  return { sex, verified: data?.status === "verified" };
}

/**
 * Soirées (section 6.2-4) : calendrier par mois, filtres, places restantes par sexe,
 * réservation ou liste d'attente, confirmation, paiement et annulation.
 * Toutes les règles (9.2) sont appliquées par la base ; la page n'affiche que les actions utiles.
 */
export default async function EveningsPage({ searchParams }: Props) {
  const t = await getTranslations("Member");
  const format = await getFormatter();
  const member = await getSessionMember();
  if (!member) return null;
  const filter = parseFilter((await searchParams).filtre);
  const [result, profile] = await Promise.all([memberApi<Evening[]>("/events"), memberProfile(member.id)]);
  const now = new Date();

  return (
    <div className="mx-auto max-w-5xl">
      <header>
        <p className="eyebrow flex items-center gap-4">
          <span aria-hidden="true" className="block h-px w-10 bg-accent" />
          {t("nav.evenings")}
        </p>
        <h1 className="mt-6 text-4xl">{t("evenings.title")}</h1>
        <p className="mt-6 max-w-measure text-lg text-fg-muted">{t("evenings.intro")}</p>
      </header>

      {!profile.verified && (
        <aside className="mt-10 border-l border-accent pl-6">
          <p className="max-w-measure text-fg-muted">{t("evenings.notVerified")}</p>
          <Link href={memberNav.verification.href} className="mt-3 inline-block text-sm text-link underline-offset-4 hover:underline">
            {t("evenings.seeVerification")}
          </Link>
        </aside>
      )}

      <nav aria-label={t("evenings.filters.label")} className="mt-12 flex flex-wrap gap-2">
        {eveningFilters.map((value) => (
          <Link
            key={value}
            href={value === "all" ? memberNav.evenings.href : { pathname: memberNav.evenings.href, query: { filtre: value } }}
            aria-current={filter === value ? "page" : undefined}
            className={cn(
              "inline-flex min-h-10 items-center rounded-sm border px-4 text-sm",
              filter === value ? "border-fg bg-fg text-bg" : "border-line text-fg hover:border-fg",
            )}
          >
            {t(`evenings.filters.${value}`)}
          </Link>
        ))}
      </nav>

      {!result.ok ? (
        <p role="alert" className="mt-14 border-l border-accent pl-5 text-fg-muted">
          {t(result.error === "unavailable" ? "errors.unavailable" : "errors.generic")}
        </p>
      ) : (
        (() => {
          const months = groupByMonth(filterEvenings(result.data, filter, profile.sex));
          if (months.length === 0) {
            return (
              <p className="mt-14 border-t border-line pt-8 text-fg-muted">
                {t(result.data.length === 0 ? "evenings.empty" : "evenings.emptyFilter")}
              </p>
            );
          }
          return months.map(({ month, evenings }) => (
            <section key={month} aria-labelledby={`mois-${month}`} className="mt-14">
              <h2 id={`mois-${month}`} className="eyebrow first-letter:uppercase">
                {format.dateTime(new Date(`${month}-15T12:00:00Z`), { month: "long", year: "numeric" })}
              </h2>
              <ol className="mt-4 border-t border-line">
                {evenings.map((evening) => {
                  const startsAt = new Date(evening.starts_at);
                  const mine = evening.mine;
                  return (
                    <li key={evening.id} className="grid gap-6 border-b border-line py-8 md:grid-cols-12 md:gap-8">
                      <div className="md:col-span-5">
                        <p className="font-serif text-2xl first-letter:uppercase">{format.dateTime(startsAt, "eventDay")}</p>
                        <p className="mt-1 text-fg-muted">
                          {format.dateTime(startsAt, "eventTime")} · {t("evenings.duration", { minutes: evening.round_minutes })}
                        </p>
                        {evening.theme && (
                          <p className="eyebrow mt-4">
                            {t("evenings.theme")}
                            {evening.theme.min_age !== null && evening.theme.max_age !== null
                              ? ` · ${t("evenings.themeAge", { min: evening.theme.min_age, max: evening.theme.max_age })}`
                              : evening.theme.min_age !== null
                                ? ` · ${t("evenings.themeMin", { min: evening.theme.min_age })}`
                                : evening.theme.max_age !== null
                                  ? ` · ${t("evenings.themeMax", { max: evening.theme.max_age })}`
                                  : ""}
                          </p>
                        )}
                      </div>

                      <dl className="grid gap-3 text-sm md:col-span-4">
                        <div>
                          <dt className="sr-only">{t("evenings.seatsLabel")}</dt>
                          <dd>
                            {t("evenings.seatsWomen", { count: freeSeats(evening, "female") })}
                            <br />
                            {t("evenings.seatsMen", { count: freeSeats(evening, "male") })}
                          </dd>
                        </div>
                        <div>
                          <dt className="sr-only">{t("evenings.priceLabel")}</dt>
                          <dd className="text-fg-muted">
                            {evening.price_xof !== null ? format.number(evening.price_xof, "fcfa") : t("evenings.noPrice")}
                          </dd>
                        </div>
                        <div>
                          <dt className="sr-only">{t("evenings.venueLabel")}</dt>
                          <dd className="text-fg-muted">
                            {evening.venue ? (
                              <>
                                <span className="text-fg">{evening.venue.name}</span>
                                <br />
                                {evening.venue.address}, {evening.venue.city}
                              </>
                            ) : (
                              t("evenings.venueHidden")
                            )}
                          </dd>
                        </div>
                      </dl>

                      <div className="md:col-span-3 md:text-right">
                        {mine && (
                          <p className="text-sm">
                            {mine.status === "booked"
                              ? now < new Date(mine.confirm_by)
                                ? t("evenings.mine.booked", {
                                    date: `${format.dateTime(new Date(mine.confirm_by), "eventDay")}, ${format.dateTime(new Date(mine.confirm_by), "eventTime")}`,
                                  })
                                : t("evenings.mine.bookedLate")
                              : mine.status === "waitlisted"
                                ? t("evenings.mine.waitlisted", { rank: mine.waitlist_rank ?? 0 })
                                : t(`evenings.mine.${mine.status}`)}
                          </p>
                        )}
                        {mine?.paid && <p className="mt-1 text-sm text-fg-muted">{t("evenings.mine.paid")}</p>}
                        <EveningActions
                          eventId={evening.id}
                          actions={profile.verified || mine ? eveningActions(evening, profile.sex, now) : []}
                        />
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ));
        })()
      )}
    </div>
  );
}
