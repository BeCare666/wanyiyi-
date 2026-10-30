import { getFormatter, getTranslations } from "next-intl/server";
import { type CoupleRow, isLive } from "@/app/[locale]/(membre)/espace/couple/couple";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { createSupabaseServer } from "@/lib/supabase/server";
import { memberNav } from "./memberNav";
import {
  type MemberStatus,
  type NextStep as Step,
  type NextStepTarget,
  type PhotoReview,
  type UpcomingBooking,
  nextStep,
  photoState,
} from "./nextStep";

const statuses: readonly MemberStatus[] = ["registering", "pending_verification", "to_correct", "verified", "suspended", "excluded", "deleted"];

const targets = {
  registration: "/inscription",
  verification: memberNav.verification.href,
  photos: `${memberNav.profile.href}#mes-photos`,
  evenings: memberNav.evenings.href,
  myEvenings: { pathname: memberNav.evenings.href, query: { filtre: "mine" } },
} as const satisfies Record<NextStepTarget, unknown>;

type BookingRow = { event_id: string; status: UpcomingBooking["status"]; confirm_by: string; pay_by: string | null };

/** Parcours du membre : étape suivante (null si rien d'utile à dire) et état des photos pour réserver. */
export type Journey = { step: Step | null; photo: ReturnType<typeof photoState> };

/** Lu avec le jeton du membre (RLS) ; null en cas d'erreur. */
export async function loadJourney(userId: string): Promise<Journey | null> {
  const supabase = await createSupabaseServer();
  if (!supabase) return null;
  const [profile, photos, couple, bookings] = await Promise.all([
    supabase.from("member_profiles").select("status").eq("user_id", userId).maybeSingle(),
    supabase.rpc("my_photos"),
    supabase.rpc("my_couple"),
    supabase.rpc("my_bookings"),
  ]);
  if (profile.error || photos.error || couple.error || bookings.error) return null;
  const status = statuses.find((s) => s === (profile.data as { status?: string } | null)?.status) ?? "none";
  const rows = (bookings.data ?? []) as BookingRow[];
  const { data: events } = rows.length
    ? await supabase.from("events").select("id, starts_at").in("id", rows.map((r) => r.event_id))
    : { data: [] as { id: string; starts_at: string }[] };
  const startsAt = new Map(((events ?? []) as { id: string; starts_at: string }[]).map((e) => [e.id, e.starts_at]));
  const reviews = ((photos.data ?? []) as { review_status: PhotoReview }[]).map((p) => p.review_status);
  const step = nextStep({
    status,
    photos: reviews,
    inCouple: ((couple.data ?? []) as CoupleRow[]).some((c) => isLive(c.status)),
    bookings: rows.flatMap((r) => {
      const start = startsAt.get(r.event_id);
      return start ? [{ startsAt: start, status: r.status, confirmBy: r.confirm_by, payBy: r.pay_by }] : [];
    }),
    now: new Date(),
  });
  return { step, photo: photoState(reviews) };
}

/**
 * Bloc « Votre prochaine étape » (décision du 30 octobre 2026), en haut du tableau de bord, des
 * soirées et du profil : une phrase, un seul bouton. `here` masque le bouton qui mènerait à la
 * page où le membre se trouve déjà.
 */
export async function NextStep({ journey, here }: { journey: Journey | null; here?: NextStepTarget[] }) {
  const step = journey?.step;
  if (!step) return null;
  const t = await getTranslations("Member.nextStep");
  const format = await getFormatter();
  const date = step.date
    ? `${format.dateTime(new Date(step.date), "eventDay")}, ${format.dateTime(new Date(step.date), "eventTime")}`
    : "";
  const showButton = step.target !== null && !(here ?? []).includes(step.target);

  return (
    <aside aria-labelledby="prochaine-etape" className="mt-10 border border-accent bg-bg-soft p-6 md:p-8">
      <h2 id="prochaine-etape" className="eyebrow">
        {t("title")}
      </h2>
      <p className="mt-4 max-w-measure font-serif text-2xl">{t(`steps.${step.key}.text`, { date })}</p>
      {showButton && (
        <ButtonLink href={targets[step.target!]} className="mt-6">
          {t(`steps.${step.key}.action`)}
        </ButtonLink>
      )}
    </aside>
  );
}
