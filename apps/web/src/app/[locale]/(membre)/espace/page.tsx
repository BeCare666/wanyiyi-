import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { memberNav } from "@/components/member/memberNav";
import { Link } from "@/i18n/navigation";
import { getSessionMember } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Member.dashboard");
  return { title: t("title") };
}

const memberStatuses = ["registering", "pending_verification", "to_correct", "verified", "suspended", "excluded", "deleted"] as const;
type MemberStatus = (typeof memberStatuses)[number];

type UpcomingEvening = { startsAt: string; state: "booked" | "confirmed" | "checked_in" | "waitlisted" };

/** Prochaine soirée du membre : place réservée, confirmée, pointée, ou liste d'attente. */
async function nextEvening(): Promise<UpcomingEvening | null> {
  const supabase = await createSupabaseServer();
  if (!supabase) return null;
  const [{ data: registrations }, { data: waitlist }] = await Promise.all([
    supabase.from("event_registrations").select("status, event:events(starts_at)").in("status", ["booked", "confirmed", "checked_in"]),
    supabase.from("waitlist_entries").select("event:events(starts_at)"),
  ]);
  const now = Date.now();
  const startsAt = (row: { event: unknown }) => (row.event as { starts_at?: string } | null)?.starts_at ?? null;
  const all: UpcomingEvening[] = [
    ...(registrations ?? []).map((r) => ({ startsAt: startsAt(r), state: r.status as UpcomingEvening["state"] })),
    ...(waitlist ?? []).map((w) => ({ startsAt: startsAt(w), state: "waitlisted" as const })),
  ].filter((e): e is UpcomingEvening => e.startsAt !== null && new Date(e.startsAt).getTime() >= now);
  return all.sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null;
}

async function memberStatus(userId: string): Promise<MemberStatus | "none"> {
  const supabase = await createSupabaseServer();
  const { data } = (await supabase?.from("member_profiles").select("status").eq("user_id", userId).maybeSingle()) ?? { data: null };
  const status = data?.status as string | undefined;
  return memberStatuses.find((s) => s === status) ?? "none";
}

/**
 * Tableau de bord (section 6.2-1) : vérification, prochaine soirée, rappel du règlement.
 * Les découvertes et messages non lus arriveront avec la phase 3.
 */
export default async function DashboardPage() {
  const t = await getTranslations("Member.dashboard");
  const format = await getFormatter();
  const member = await getSessionMember();
  if (!member) return null;
  const [status, evening] = await Promise.all([memberStatus(member.id), nextEvening()]);

  return (
    <div className="mx-auto max-w-5xl">
      <header>
        <p className="eyebrow flex items-center gap-4">
          <span aria-hidden="true" className="block h-px w-10 bg-accent" />
          {t("title")}
        </p>
        <h1 className="mt-6 text-4xl">{member.firstName ? t("greeting", { name: member.firstName }) : t("greetingNoName")}</h1>
      </header>

      <dl className="mt-14 border-t border-line">
        <div className="grid gap-3 border-b border-line py-8 md:grid-cols-12 md:gap-8">
          <dt className="eyebrow md:col-span-4">{t("verification")}</dt>
          <dd className="md:col-span-8">
            <Link href={memberNav.verification.href} className="font-serif text-2xl underline-offset-8 hover:underline">
              {t(`status.${status}`)}
            </Link>
          </dd>
        </div>

        <div className="grid gap-3 border-b border-line py-8 md:grid-cols-12 md:gap-8">
          <dt className="eyebrow md:col-span-4">{t("nextEvening")}</dt>
          <dd className="md:col-span-8">
            {evening ? (
              <>
                <p className="font-serif text-2xl first-letter:uppercase">
                  {format.dateTime(new Date(evening.startsAt), "eventDay")}, {format.dateTime(new Date(evening.startsAt), "eventTime")}
                </p>
                <p className="mt-2 text-fg-muted">{t(`registration.${evening.state}`)}</p>
              </>
            ) : (
              <p className="text-fg-muted">{t("noEvening")}</p>
            )}
            <ButtonLink href={memberNav.evenings.href} variant="secondary" size="sm" className="mt-6">
              {t("seeEvenings")}
            </ButtonLink>
          </dd>
        </div>
      </dl>

      <aside className="mt-14 border-l border-accent pl-6">
        <h2 className="font-serif text-2xl">{t("rulesTitle")}</h2>
        <p className="mt-4 max-w-measure text-fg-muted">{t("rulesText")}</p>
        <Link href={memberNav.rules.href} className="mt-4 inline-block text-sm text-link underline-offset-4 hover:underline">
          {t("rulesLink")}
        </Link>
      </aside>
    </div>
  );
}
