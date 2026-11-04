import { PROFILE_CATALOG } from "@wanyiyi/shared";
import { describe, expect, it } from "vitest";
import fr from "../messages/fr.json";
import { type ParticipantRow, paymentSummary } from "../src/app/[locale]/(admin)/admin/soirees/evenings";
import { type Answers, isProfileComplete } from "../src/app/[locale]/(membre)/espace/profil/profile";
import { discoveryGuide } from "../src/app/[locale]/(membre)/espace/matchs/discoveries";
import { nextMilestone } from "../src/app/[locale]/(membre)/espace/couple/couple";
import { eveningActions, type Evening } from "../src/app/[locale]/(membre)/espace/soirees/evenings";
import { type NextStepInput, nextStep, phaseStates, photoState, type UpcomingBooking } from "../src/components/member/journeyRules";

/** « Votre prochaine étape » (décision du 30 octobre 2026) : une phrase, un bouton. */

const now = new Date("2026-10-30T12:00:00Z");
const base: NextStepInput = { status: "verified", photos: ["approved"], inCouple: false, bookings: [], now };
const booking = (over: Partial<UpcomingBooking>): UpcomingBooking => ({
  startsAt: "2026-11-06T19:00:00Z",
  status: "booked",
  confirmBy: "2026-11-04T19:00:00Z",
  payBy: null,
  ...over,
});

describe("Étape suivante du membre", () => {
  it("inscription, vérification, correction et attente de l'équipe", () => {
    expect(nextStep({ ...base, status: "none" })).toEqual({ key: "startRegistration", target: "registration" });
    expect(nextStep({ ...base, status: "registering" })).toEqual({ key: "finishVerification", target: "verification" });
    expect(nextStep({ ...base, status: "to_correct" })).toEqual({ key: "correct", target: "verification" });
    expect(nextStep({ ...base, status: "pending_verification" })).toEqual({ key: "waitReview", target: null });
    expect(nextStep({ ...base, status: "pending_verification", photos: [] })).toEqual({ key: "waitReviewAddPhoto", target: "photos" });
  });

  it("compte validé : photo à ajouter, photo en relecture, puis réserver", () => {
    expect(nextStep({ ...base, photos: [] })?.key).toBe("addPhoto");
    expect(nextStep({ ...base, photos: ["rejected"] })?.key).toBe("addPhoto");
    expect(nextStep({ ...base, photos: ["pending", "rejected"] })).toEqual({ key: "photoPending", target: null });
    expect(nextStep({ ...base, photos: ["pending", "approved"] })).toEqual({ key: "book", target: "evenings" });
  });

  it("place prise : payer, puis confirmer avant la limite, puis rappel de la soirée", () => {
    expect(nextStep({ ...base, bookings: [booking({ payBy: "2026-10-31T12:00:00Z" })] })).toEqual({
      key: "pay",
      target: "myEvenings",
      date: "2026-10-31T12:00:00Z",
    });
    expect(nextStep({ ...base, bookings: [booking({})] })).toEqual({ key: "confirm", target: "myEvenings", date: "2026-11-04T19:00:00Z" });
    expect(nextStep({ ...base, bookings: [booking({ confirmBy: "2026-10-30T11:00:00Z" })] })?.key).toBe("ready");
    expect(nextStep({ ...base, bookings: [booking({ status: "confirmed" })] })).toEqual({ key: "ready", target: "myEvenings", date: "2026-11-06T19:00:00Z" });
    expect(nextStep({ ...base, bookings: [booking({ status: "waitlisted" })] })?.key).toBe("waitlisted");
    // Une place gardée sans photo (inscription d'avant la règle) reste l'étape à suivre
    expect(nextStep({ ...base, photos: [], bookings: [booking({ status: "confirmed" })] })?.key).toBe("ready");
  });

  it("place libérée ou soirée passée : ignorées", () => {
    expect(nextStep({ ...base, bookings: [booking({ status: "released" })] })?.key).toBe("book");
    expect(nextStep({ ...base, bookings: [booking({ startsAt: "2026-10-29T19:00:00Z" })] })?.key).toBe("book");
  });

  it("rien à dire : couple en cours, compte suspendu, exclu ou en suppression", () => {
    expect(nextStep({ ...base, inCouple: true })).toBeNull();
    for (const status of ["suspended", "excluded", "deleted"] as const) expect(nextStep({ ...base, status })).toBeNull();
  });

  it("état des photos pour réserver", () => {
    expect(photoState([])).toBe("missing");
    expect(photoState(["rejected"])).toBe("missing");
    expect(photoState(["pending"])).toBe("pending");
    expect(photoState(["rejected", "approved"])).toBe("approved");
  });

  it("chaque étape a son texte, et un bouton quand elle mène quelque part", () => {
    const steps = fr.Member.nextStep.steps as Record<string, { text: string; action?: string }>;
    const inputs: NextStepInput[] = [
      { ...base, status: "none" },
      { ...base, status: "registering" },
      { ...base, status: "to_correct" },
      { ...base, status: "pending_verification" },
      { ...base, status: "pending_verification", photos: [] },
      { ...base, photos: [] },
      { ...base, photos: ["pending"] },
      { ...base, bookings: [booking({ payBy: "2026-10-31T12:00:00Z" })] },
      { ...base, bookings: [booking({})] },
      { ...base, bookings: [booking({ status: "waitlisted" })] },
      { ...base, bookings: [booking({ status: "confirmed" })] },
      { ...base, status: "pending_verification", profileComplete: false },
      { ...base, photos: ["pending"], profileComplete: false },
      { ...base, profileComplete: false },
      base,
    ];
    const seen = inputs.map((input) => nextStep(input)!);
    expect(new Set(seen.map((s) => s.key)).size).toBe(Object.keys(steps).length);
    for (const step of seen) {
      expect(steps[step.key]?.text).toBeTruthy();
      expect(Boolean(steps[step.key]?.action)).toBe(step.target !== null);
    }
  });
});

describe("Profil complet (message de fin, 30 octobre 2026)", () => {
  const full = (side: "self" | "seeking") =>
    Object.fromEntries(PROFILE_CATALOG.filter((c) => !c.optional).map((c) => [c.key, c.options.slice(0, c.key === "personality" ? 3 : 1)]));
  it("complet seulement avec les deux côtés remplis et les 3 textes", () => {
    const answers: Answers = { self: full("self"), seeking: full("seeking") };
    expect(isProfileComplete(answers, 3)).toBe(true);
    expect(isProfileComplete(answers, 2)).toBe(false);
    expect(isProfileComplete({ ...answers, seeking: {} }, 3)).toBe(false);
  });
});

describe("Fiche d'une soirée : places payées (30 octobre 2026)", () => {
  const row = (paid: boolean, paid_xof: number) => ({ paid, paid_xof }) as ParticipantRow;
  it("compte les places payées et additionne le montant encaissé", () => {
    expect(paymentSummary([row(true, 10000), row(true, 8000), row(false, 0)])).toEqual({ paid: 2, collected: 18000 });
    expect(paymentSummary([])).toEqual({ paid: 0, collected: 0 });
  });
});

describe("Audit UX du 3 novembre 2026 : parcours étape par étape", () => {
  it("le profil incomplet est demandé pendant l'attente, après la photo, et avant la première réservation", () => {
    expect(nextStep({ ...base, status: "pending_verification", profileComplete: false })).toEqual({ key: "waitReviewProfile", target: "profile" });
    // La photo passe avant le profil : elle est examinée avec le dossier
    expect(nextStep({ ...base, status: "pending_verification", photos: [], profileComplete: false })?.key).toBe("waitReviewAddPhoto");
    expect(nextStep({ ...base, photos: ["pending"], profileComplete: false })).toEqual({ key: "photoPendingProfile", target: "profile" });
    expect(nextStep({ ...base, profileComplete: false })).toEqual({ key: "completeProfile", target: "profile" });
    // Une place déjà prise reste l'étape à suivre
    expect(nextStep({ ...base, profileComplete: false, bookings: [booking({ status: "confirmed" })] })?.key).toBe("ready");
  });

  it("frise : étapes faites, en cours et à venir", () => {
    const at = (input: NextStepInput) => phaseStates(input, nextStep(input));
    expect(at({ ...base, status: "registering", photos: [], profileComplete: false })).toEqual({
      account: "done",
      verification: "current",
      photo: "todo",
      profile: "todo",
      evening: "todo",
    });
    expect(at({ ...base, status: "pending_verification", photos: [], profileComplete: false }).photo).toBe("current");
    expect(at({ ...base, profileComplete: false })).toEqual({ account: "done", verification: "done", photo: "done", profile: "current", evening: "todo" });
    expect(at(base).evening).toBe("current");
    expect(at({ ...base, bookings: [booking({ status: "confirmed" })] }).evening).toBe("done");
  });

  it("soirée payante : pas de bouton Confirmer, le paiement confirme ; soirée gratuite : Confirmer reste", () => {
    const evening = (price: number | null) =>
      ({ price_xof: price, mine: { status: "booked", confirm_by: "2026-11-04T19:00:00Z", paid: false } }) as unknown as Evening;
    expect(eveningActions(evening(10000), "female", now)).toEqual(["pay", "cancel"]);
    expect(eveningActions(evening(null), "female", now)).toEqual(["confirm", "cancel"]);
  });

  it("découverte : écrire, se rencontrer, puis décider ; la décision passe devant à la fin", () => {
    expect(discoveryGuide({ sentMessages: 0, dates: 0, wantsToContinue: false, daysLeft: 12 })).toMatchObject({ key: "writeFirst", tab: "discussion" });
    expect(discoveryGuide({ sentMessages: 2, dates: 0, wantsToContinue: false, daysLeft: 12 })).toMatchObject({
      key: "planDate",
      tab: "dates",
      steps: { talk: "done", meet: "current", decide: "todo" },
    });
    expect(discoveryGuide({ sentMessages: 2, dates: 1, wantsToContinue: false, daysLeft: 8 })).toMatchObject({ key: "decide", tab: "decision" });
    expect(discoveryGuide({ sentMessages: 0, dates: 0, wantsToContinue: false, daysLeft: 2 })).toMatchObject({ key: "decideSoon", tab: "decision" });
    expect(discoveryGuide({ sentMessages: 2, dates: 1, wantsToContinue: true, daysLeft: 2 })).toMatchObject({ key: "decided", tab: null });
  });

  it("couple : la prochaine étape du parcours est la première non franchie", () => {
    const row = (kind: string, reached: boolean) => ({ kind, reached_at: reached ? "2026-11-01T10:00:00Z" : null, i_confirmed_reach: false, i_confirmed_remove: false });
    expect(nextMilestone([row("first_dates", true), row("counselor_sessions", false), row("celebration", false)] as never)?.kind).toBe("counselor_sessions");
    expect(nextMilestone([row("first_dates", true)] as never)).toBeNull();
  });

  it("chaque texte des guides existe dans les 3 langues", async () => {
    for (const locale of ["fr", "en", "yo"]) {
      const m = (await import(`../messages/${locale}.json`)).default;
      for (const key of ["writeFirst", "planDate", "decide", "decideSoon", "decided"]) expect(m.Member.discoveries.guide.text[key], `${locale} ${key}`).toBeTruthy();
      for (const key of ["discussion", "journey", "support", "together", "decisions"]) expect(m.Member.couple.tabs[key], `${locale} ${key}`).toBeTruthy();
      for (const key of ["account", "verification", "photo", "profile", "evening"]) expect(m.Member.nextStep.phases[key], `${locale} ${key}`).toBeTruthy();
      for (const kind of ["registration_completed", "verification_submitted", "profile_photo_approved", "evening_booked", "evening_confirmed", "evening_waitlisted", "evening_registration_cancelled", "evening_seat_released"])
        expect(m.Member.bell.kinds[kind], `${locale} ${kind}`).toBeTruthy();
    }
  });
});
