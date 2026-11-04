import { getFormatter, getTranslations } from "next-intl/server";
import { CheckIcon } from "@phosphor-icons/react/ssr";
import { type CoupleRow, isLive } from "@/app/[locale]/(membre)/espace/couple/couple";
import { answersFrom, isProfileComplete } from "@/app/[locale]/(membre)/espace/profil/profile";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { cn } from "@/lib/cn";
import { createSupabaseServer } from "@/lib/supabase/server";
import { memberNav } from "./memberNav";
import {
  journeyPhases,
  type JourneyPhase,
  type MemberStatus,
  type NextStep as Step,
  type PhaseState,
  phaseStates,
  type NextStepTarget,
  type PhotoReview,
  type UpcomingBooking,
  nextStep,
  photoState,
} from "./journeyRules";

const statuses: readonly MemberStatus[] = ["registering", "pending_verification", "to_correct", "verified", "suspended", "excluded", "deleted"];

const targets = {
  registration: "/inscription",
  verification: memberNav.verification.href,
  // Photo demandée avec le dossier (audit UX du 3 novembre 2026) : section de la page Vérification
  photos: `${memberNav.verification.href}#mes-photos`,
  profile: memberNav.profile.href,
  evenings: memberNav.evenings.href,
  myEvenings: { pathname: memberNav.evenings.href, query: { filtre: "mine" } },
} as const satisfies Record<NextStepTarget, unknown>;

type BookingRow = { event_id: string; status: UpcomingBooking["status"]; confirm_by: string; pay_by: string | null };

/** Parcours du membre : étape suivante (null si rien d'utile à dire) et état des photos pour réserver. */
export type Journey = { step: Step | null; photo: ReturnType<typeof photoState>; phases: Record<JourneyPhase, PhaseState> };

/** Lu avec le jeton du membre (RLS) ; null en cas d'erreur. */
export async function loadJourney(userId: string): Promise<Journey | null> {
  const supabase = await createSupabaseServer();
  if (!supabase) return null;
  const [profile, photos, couple, bookings, answers, texts] = await Promise.all([
    supabase.from("member_profiles").select("status").eq("user_id", userId).maybeSingle(),
    supabase.rpc("my_photos"),
    supabase.rpc("my_couple"),
    supabase.rpc("my_bookings"),
    supabase.from("profile_answers").select("side, category, values").eq("user_id", userId),
    supabase.from("profile_texts").select("body").eq("user_id", userId),
  ]);
  if (profile.error || photos.error || couple.error || bookings.error) return null;
  // Profil illisible : considéré complet, pour ne pas bloquer le membre sur une étape fausse
  const profileComplete =
    answers.error || texts.error
      ? true
      : isProfileComplete(
          answersFrom((answers.data ?? []) as { side: string; category: string; values: string[] }[]),
          ((texts.data ?? []) as { body: string }[]).filter((x) => x.body.trim() !== "").length,
        );
  const status = statuses.find((s) => s === (profile.data as { status?: string } | null)?.status) ?? "none";
  const rows = (bookings.data ?? []) as BookingRow[];
  const { data: events } = rows.length
    ? await supabase.from("events").select("id, starts_at").in("id", rows.map((r) => r.event_id))
    : { data: [] as { id: string; starts_at: string }[] };
  const startsAt = new Map(((events ?? []) as { id: string; starts_at: string }[]).map((e) => [e.id, e.starts_at]));
  const reviews = ((photos.data ?? []) as { review_status: PhotoReview }[]).map((p) => p.review_status);
  const input = {
    status,
    photos: reviews,
    inCouple: ((couple.data ?? []) as CoupleRow[]).some((c) => isLive(c.status)),
    bookings: rows.flatMap((r) => {
      const start = startsAt.get(r.event_id);
      return start ? [{ startsAt: start, status: r.status, confirmBy: r.confirm_by, payBy: r.pay_by }] : [];
    }),
    now: new Date(),
    profileComplete,
  };
  const step = nextStep(input);
  return { step, photo: photoState(reviews), phases: phaseStates(input, step) };
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
      {/* Frise du parcours (audit UX du 3 novembre 2026) : où en est le membre, étape par étape */}
      <ol aria-label={t("phasesLabel")} className="mb-8 grid grid-cols-5 gap-2">
        {journeyPhases.map((phase, i) => {
          const state = journey!.phases[phase];
          return (
            <li key={phase} aria-current={state === "current" ? "step" : undefined} className="min-w-0">
              <span
                aria-hidden="true"
                className={cn("block h-1 rounded-full", state === "done" ? "bg-fg" : state === "current" ? "bg-accent" : "bg-line")}
              />
              <span className={cn("mt-2 flex items-center gap-1 text-xs leading-tight", state === "todo" ? "text-fg-muted" : "text-fg")}>
                {state === "done" ? <CheckIcon size={12} weight="bold" aria-hidden="true" className="shrink-0" /> : <span aria-hidden="true">{i + 1}.</span>}
                <span className="truncate">{t(`phases.${phase}`)}</span>
                <span className="sr-only">, {t(`phaseStates.${state}`)}</span>
              </span>
            </li>
          );
        })}
      </ol>
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
