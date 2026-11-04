/**
 * « Votre prochaine étape » (décision du 30 octobre 2026) : une phrase et un seul bouton, du
 * début de l'inscription jusqu'à la soirée. Calcul pur : les règles restent appliquées par la
 * base (app.book_event), ce bloc ne fait que dire au membre ce qu'il lui reste à faire.
 */

export type MemberStatus = "registering" | "pending_verification" | "to_correct" | "verified" | "suspended" | "excluded" | "deleted" | "none";
export type PhotoReview = "pending" | "approved" | "rejected";

/** Inscription à venir du membre (app.my_bookings, soirée pas encore commencée). */
export type UpcomingBooking = {
  startsAt: string;
  status: "booked" | "confirmed" | "checked_in" | "released" | "waitlisted";
  confirmBy: string;
  payBy: string | null;
};

export type NextStepInput = {
  status: MemberStatus;
  photos: readonly PhotoReview[];
  inCouple: boolean;
  bookings: readonly UpcomingBooking[];
  now: Date;
  /** Profil rempli à 100 % des deux côtés (audit UX du 3 novembre 2026). Absent : considéré complet. */
  profileComplete?: boolean;
};

export type NextStepKey =
  | "startRegistration"
  | "finishVerification"
  | "correct"
  | "waitReview"
  | "waitReviewAddPhoto"
  | "waitReviewProfile"
  | "addPhoto"
  | "photoPending"
  | "photoPendingProfile"
  | "completeProfile"
  | "pay"
  | "confirm"
  | "waitlisted"
  | "ready"
  | "book";

export type NextStepTarget = "registration" | "verification" | "photos" | "profile" | "evenings" | "myEvenings";

export type NextStep = { key: NextStepKey; target: NextStepTarget | null; date?: string };

/** Le membre peut réserver côté photos : au moins une photo approuvée par l'équipe. */
export function hasApprovedPhoto(photos: readonly PhotoReview[]): boolean {
  return photos.includes("approved");
}

/** Photo à ajouter : aucune photo, ou seulement des photos refusées. */
function needsPhoto(photos: readonly PhotoReview[]): boolean {
  return !photos.some((p) => p !== "rejected");
}

/** Où en sont les photos pour réserver : à ajouter, en relecture, ou au moins une approuvée. */
export function photoState(photos: readonly PhotoReview[]): "missing" | "pending" | "approved" {
  return hasApprovedPhoto(photos) ? "approved" : needsPhoto(photos) ? "missing" : "pending";
}

/**
 * Étape suivante, ou null quand le bloc n'a rien d'utile à dire (couple en cours, compte
 * suspendu, exclu ou en suppression : la page l'affiche déjà).
 */
export function nextStep({ status, photos, inCouple, bookings, now, profileComplete = true }: NextStepInput): NextStep | null {
  switch (status) {
    case "none":
      return { key: "startRegistration", target: "registration" };
    case "registering":
      return { key: "finishVerification", target: "verification" };
    case "to_correct":
      return { key: "correct", target: "verification" };
    case "pending_verification":
      // L'attente de l'équipe sert à préparer la suite : la photo d'abord (examinée avec le dossier), puis le profil
      if (needsPhoto(photos)) return { key: "waitReviewAddPhoto", target: "photos" };
      return profileComplete ? { key: "waitReview", target: null } : { key: "waitReviewProfile", target: "profile" };
    case "verified":
      break;
    default:
      return null;
  }
  if (inCouple) return null;

  // Une place déjà prise passe avant les photos : la règle de la photo vaut pour les nouvelles réservations
  const upcoming = bookings
    .filter((b) => b.status !== "released" && new Date(b.startsAt).getTime() > now.getTime())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const toPay = upcoming.find((b) => b.payBy !== null && (b.status === "booked" || b.status === "confirmed"));
  if (toPay) return { key: "pay", target: "myEvenings", date: toPay.payBy! };
  const toConfirm = upcoming.find((b) => b.status === "booked" && now.getTime() < new Date(b.confirmBy).getTime());
  if (toConfirm) return { key: "confirm", target: "myEvenings", date: toConfirm.confirmBy };
  const next = upcoming[0];
  if (next) return { key: next.status === "waitlisted" ? "waitlisted" : "ready", target: "myEvenings", date: next.startsAt };

  const photo = photoState(photos);
  if (photo === "missing") return { key: "addPhoto", target: "photos" };
  if (photo === "pending") return profileComplete ? { key: "photoPending", target: null } : { key: "photoPendingProfile", target: "profile" };
  // Les autres découvrent le membre par sa description : profil complet avant la première réservation
  if (!profileComplete) return { key: "completeProfile", target: "profile" };
  return { key: "book", target: "evenings" };
}

/** Étapes du parcours, montrées en frise au-dessus de l'étape suivante (audit UX du 3 novembre 2026). */
export const journeyPhases = ["account", "verification", "photo", "profile", "evening"] as const;
export type JourneyPhase = (typeof journeyPhases)[number];
export type PhaseState = "done" | "current" | "todo";

/**
 * État de chaque étape : faite, en cours (celle de l'étape suivante) ou à venir. La photo et le
 * profil peuvent être faits avant la validation du dossier.
 */
export function phaseStates(input: NextStepInput, step: NextStep | null): Record<JourneyPhase, PhaseState> {
  const { status, photos, profileComplete = true } = input;
  const verified = status === "verified";
  const photo = photoState(photos);
  const current: JourneyPhase | null = !step
    ? null
    : step.key === "startRegistration"
      ? "account"
      : ["finishVerification", "correct", "waitReview"].includes(step.key)
        ? "verification"
        : ["waitReviewAddPhoto", "addPhoto", "photoPending"].includes(step.key)
          ? "photo"
          : ["waitReviewProfile", "photoPendingProfile", "completeProfile"].includes(step.key)
            ? "profile"
            : "evening";
  const done: Record<JourneyPhase, boolean> = {
    account: status !== "none",
    verification: verified,
    photo: photo === "approved",
    profile: profileComplete,
    evening: step?.key === "ready",
  };
  return Object.fromEntries(
    journeyPhases.map((p) => [p, p === current && !done[p] ? "current" : done[p] ? "done" : "todo"]),
  ) as Record<JourneyPhase, PhaseState>;
}
