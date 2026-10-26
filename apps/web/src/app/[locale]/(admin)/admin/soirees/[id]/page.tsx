import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Link } from "@/i18n/navigation";
import { getStaffMember } from "@/lib/staff";
import { createSupabaseServer } from "@/lib/supabase/server";
import { memberName } from "../../verifications/queue";
import { canCheckIn, type EventStatus, groupParticipants, nextStep, type ParticipantRow, toCotonouInput } from "../evenings";
import { EventForm } from "../EventForm";
import { loadEventOptions } from "../options";
import { type CompositionAlert, involvedCount, showComposition, splitAlerts } from "../composition";
import { canPrintTables } from "../tables";
import { CancelEveningButton, CheckInButton, DeleteDraftButton, StepButton } from "./EveningControls";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.nav");
  return { title: t("evenings") };
}

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type EventRow = {
  id: string;
  venue_id: string | null;
  theme_id: string | null;
  starts_at: string;
  status: EventStatus;
  capacity_women: number;
  capacity_men: number;
  round_minutes: number;
  changeover_minutes: number;
  price_xof: number | null;
  results_computed_at: string | null;
  venue: { name: string; address: string; city: string } | null;
  theme: { key: string } | null;
};
type Results = { checked_in: number; voters: number; matches: number; announced_at: string; results_computed_at: string | null };
type MatchRow = { match_id: string; member_a_number: string; member_a_first_name: string | null; member_b_number: string; member_b_first_name: string | null };

/** Lecture avec le jeton de la personne : la permission events.manage est contrôlée par la base. */
async function loadEvening(id: string) {
  const supabase = await createSupabaseServer();
  if (!supabase) return null;
  const { data } = await supabase
    .from("events")
    .select(
      "id, venue_id, theme_id, starts_at, status, capacity_women, capacity_men, round_minutes, changeover_minutes, price_xof, results_computed_at, venue:venues(name, address, city), theme:themes(key)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const event = data as unknown as EventRow;
  const [participants, rounds, results, matches, alerts] = await Promise.all([
    supabase.rpc("event_participants", { p_event: id }),
    supabase.from("rounds").select("id", { count: "exact", head: true }).eq("event_id", id),
    supabase.rpc("event_results", { p_event: id }),
    supabase.rpc("event_matches", { p_event: id }),
    // Composition assistée (section 11.2-5) : critères non négociables incompatibles
    showComposition(event.status) ? supabase.rpc("event_composition_alerts", { p_event: id }) : Promise.resolve({ data: [] }),
  ]);
  return {
    event,
    participants: (participants.data as ParticipantRow[] | null) ?? [],
    rounds: rounds.count ?? 0,
    results: ((results.data as Results[] | null) ?? [])[0] ?? null,
    matches: (matches.data as MatchRow[] | null) ?? [],
    alerts: (alerts.data as CompositionAlert[] | null) ?? [],
  };
}

/**
 * Fiche d'une soirée (section 11.2-5) : brouillon modifiable, déroulé pas à pas
 * (publication, préparation, début, fin, matchs), inscriptions et pointage, résultats.
 */
export default async function AdminEveningPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("events.manage")) notFound();
  const evening = await loadEvening(id);
  if (!evening) notFound();

  const t = await getTranslations("Admin");
  const tp = await getTranslations("Profile");
  const format = await getFormatter();
  const { event, participants, rounds, results, matches, alerts } = evening;
  const prepared = rounds > 0;
  const step = nextStep(event.status, prepared, event.results_computed_at !== null);
  const dateTime = (iso: string) => format.dateTime(new Date(iso), { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const published = event.status === "published" || event.status === "full";
  // Modifiable en brouillon, et une fois publiée tant que les tables ne sont pas préparées (19 octobre 2026)
  const editable = event.status === "draft" || (published && !prepared);
  const options = editable ? await loadEventOptions() : null;

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/admin/soirees" className="text-sm text-link underline-offset-4 hover:underline">
        {t("evenings.back")}
      </Link>

      <header className="mt-6">
        <p className="eyebrow">{t(`evenings.status.${event.status}`)}</p>
        <h1 className="mt-4 text-4xl first-letter:uppercase">{dateTime(event.starts_at)}</h1>
        <p className="mt-4 text-fg-muted">
          {event.venue ? `${event.venue.name} · ${event.venue.address}, ${event.venue.city}` : t("evenings.noVenue")}
          {event.theme && ` · ${event.theme.key}`}
        </p>
      </header>

      <dl className="mt-10 grid gap-6 border-t border-line pt-8 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-fg-muted">{t("evenings.columns.women")}</dt>
          <dd className="mt-1 tabular-nums">{event.capacity_women}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">{t("evenings.columns.men")}</dt>
          <dd className="mt-1 tabular-nums">{event.capacity_men}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">{t("evenings.form.roundMinutes")}</dt>
          <dd className="mt-1 tabular-nums">{t("evenings.minutes", { count: event.round_minutes })}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">{t("evenings.form.price")}</dt>
          <dd className="mt-1 tabular-nums">
            {event.price_xof === null ? t("evenings.noPrice") : format.number(event.price_xof, { style: "currency", currency: "XOF", maximumFractionDigits: 0 })}
          </dd>
        </div>
      </dl>

      {step && (
        <section aria-labelledby="step" className="mt-12 border-t border-line pt-8">
          <h2 id="step" className="text-2xl">{t(`evenings.steps.${step}.title`)}</h2>
          <div className="mt-4">
            <StepButton eventId={event.id} step={step} />
          </div>
        </section>
      )}

      {canPrintTables(event.status, prepared) && (
        <section aria-labelledby="tables" className="mt-12 border-t border-line pt-8">
          <h2 id="tables" className="text-2xl">{t("evenings.tables.title")}</h2>
          <p className="mt-4 max-w-measure text-fg-muted">{t("evenings.tables.help")}</p>
          <ButtonLink href={`/admin/soirees/${event.id}/qr`} variant="secondary" className="mt-6">
            {t("evenings.tables.open")}
          </ButtonLink>
        </section>
      )}

      {event.status === "in_progress" && prepared && (
        <section aria-labelledby="timer" className="mt-12 border-t border-line pt-8">
          <h2 id="timer" className="text-2xl">{t("evenings.timer.title")}</h2>
          <p className="mt-4 max-w-measure text-fg-muted">{t("evenings.timer.help")}</p>
          <ButtonLink href={`/admin/soirees/${event.id}/minuteur`} className="mt-6">
            {t("evenings.timer.open")}
          </ButtonLink>
        </section>
      )}

      {options && (
        <section aria-labelledby="edit" className="mt-12 border-t border-line pt-8">
          <h2 id="edit" className="text-2xl">{t(published ? "evenings.editPublishedTitle" : "evenings.editTitle")}</h2>
          <div className="mt-6">
            <EventForm
              eventId={event.id}
              published={published}
              initial={{
                venueId: event.venue_id,
                themeId: event.theme_id,
                startsAt: toCotonouInput(new Date(event.starts_at)),
                capacityWomen: event.capacity_women,
                capacityMen: event.capacity_men,
                roundMinutes: event.round_minutes,
                changeoverMinutes: event.changeover_minutes,
                priceXof: event.price_xof,
              }}
              venues={options.venues}
              themes={options.themes}
            />
          </div>
          {event.status === "draft" && (
            <div className="mt-10 border-t border-line pt-8">
              <DeleteDraftButton eventId={event.id} />
            </div>
          )}
        </section>
      )}

      {published && (
        <section aria-labelledby="cancel" className="mt-12 border-t border-line pt-8">
          <h2 id="cancel" className="text-2xl">{t("evenings.cancel.title")}</h2>
          <div className="mt-4">
            <CancelEveningButton eventId={event.id} />
          </div>
        </section>
      )}

      {event.status !== "draft" && (
        <section aria-labelledby="participants" className="mt-12 border-t border-line pt-8">
          <h2 id="participants" className="text-2xl">{t("evenings.participants.title")}</h2>
          {prepared && <p className="mt-2 text-sm text-fg-muted">{t("evenings.participants.prepared", { tables: rounds })}</p>}
          <div className="mt-6 grid gap-12 lg:grid-cols-2">
            {(["female", "male"] as const).map((sex) => {
              const { seated, waiting, other } = groupParticipants(participants, sex);
              const capacity = sex === "female" ? event.capacity_women : event.capacity_men;
              return (
                <div key={sex}>
                  <h3 className="eyebrow">
                    {t(`evenings.columns.${sex === "female" ? "women" : "men"}`)} · {t("evenings.fill", { taken: seated.length, capacity })}
                  </h3>
                  {seated.length + waiting.length + other.length === 0 ? (
                    <p className="mt-4 text-sm text-fg-muted">{t("evenings.participants.none")}</p>
                  ) : (
                    <ul className="mt-4 divide-y divide-line border-y border-line text-sm">
                      {[...seated, ...waiting, ...other].map((p) => {
                        const name = memberName(p) ?? p.member_number ?? "·";
                        return (
                          <li key={p.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                            <span>
                              <span className="font-medium">{name}</span>
                              {p.member_number && <span className="ml-2 text-fg-muted">{p.member_number}</span>}
                              <span className="block text-fg-muted">
                                {p.status === "waitlisted"
                                  ? t("evenings.participants.waitlisted", { rank: p.waitlist_position ?? 0 })
                                  : t(`evenings.participants.status.${p.status}`)}
                                {p.seat_number !== null && ` · ${t("evenings.participants.seat", { seat: p.seat_number })}`}
                              </span>
                            </span>
                            {canCheckIn(p, event.status, prepared) && <CheckInButton eventId={event.id} userId={p.user_id} name={name} />}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {showComposition(event.status) && (
        <section aria-labelledby="composition" className="mt-12 border-t border-line pt-8">
          <h2 id="composition" className="text-2xl">{t("evenings.composition.title")}</h2>
          <p className="mt-2 max-w-measure text-sm text-fg-muted">{t("evenings.composition.help")}</p>
          {alerts.length === 0 ? (
            <p className="mt-6 border-l border-line-strong pl-5 text-sm">{t("evenings.composition.none")}</p>
          ) : (
            <>
              {involvedCount(alerts) > 0 && (
                <p role="alert" className="mt-6 border-l border-accent pl-5 text-sm">
                  {t("evenings.composition.summary", { people: involvedCount(alerts) })}
                </p>
              )}
              {(["incompatible", "unknown"] as const).map((kind) => {
                const list = splitAlerts(alerts)[kind];
                if (list.length === 0) return null;
                const values = (category: string, items: string[]) =>
                  items.map((v) => (tp.has(`${category}.options.${v}`) ? tp(`${category}.options.${v}`) : v)).join(", ");
                return (
                  <div key={kind} className="mt-8">
                    <h3 className="eyebrow">{t(`evenings.composition.kinds.${kind}`, { count: list.length })}</h3>
                    <ul className="mt-4 divide-y divide-line border-y border-line text-sm">
                      {list.map((a) => (
                        <li key={`${a.holder_id}-${a.other_id}-${a.category}`} className="py-3">
                          <p>
                            <span className="font-medium">{a.holder_first_name ?? a.holder_number}</span>
                            <span className="text-fg-muted"> · </span>
                            <span className="font-medium">{a.other_first_name ?? a.other_number}</span>
                          </p>
                          <p className="mt-1 text-fg-muted">
                            {t(`evenings.composition.lines.${kind}`, {
                              holder: a.holder_first_name ?? a.holder_number ?? "",
                              other: a.other_first_name ?? a.other_number ?? "",
                              category: tp.has(`${a.category}.title`) ? tp(`${a.category}.title`) : a.category,
                              sought: values(a.category, a.sought),
                              declared: values(a.category, a.declared ?? []),
                            })}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </>
          )}
        </section>
      )}

      {results && (event.status === "in_progress" || event.status === "finished") && (
        <section aria-labelledby="results" className="mt-12 border-t border-line pt-8">
          <h2 id="results" className="text-2xl">{t("evenings.results.title")}</h2>
          <dl className="mt-6 grid gap-6 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-fg-muted">{t("evenings.results.checkedIn")}</dt>
              <dd className="mt-1 text-2xl tabular-nums">{results.checked_in}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">{t("evenings.results.voters")}</dt>
              <dd className="mt-1 text-2xl tabular-nums">{results.voters}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">{t("evenings.results.matches")}</dt>
              <dd className="mt-1 text-2xl tabular-nums">{results.results_computed_at ? results.matches : "·"}</dd>
            </div>
          </dl>
          <p className="mt-6 text-sm text-fg-muted">
            {t("evenings.results.announce", { date: dateTime(results.announced_at) })} {t("evenings.results.noNo")}
          </p>
          {matches.length > 0 && (
            <ul className="mt-6 divide-y divide-line border-y border-line text-sm">
              {matches.map((m) => (
                <li key={m.match_id} className="py-3">
                  {m.member_a_first_name ?? "·"} <span className="text-fg-muted">{m.member_a_number}</span>
                  {" · "}
                  {m.member_b_first_name ?? "·"} <span className="text-fg-muted">{m.member_b_number}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
