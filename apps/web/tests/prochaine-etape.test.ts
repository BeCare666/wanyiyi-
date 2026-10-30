import { PROFILE_CATALOG } from "@wanyiyi/shared";
import { describe, expect, it } from "vitest";
import fr from "../messages/fr.json";
import { type ParticipantRow, paymentSummary } from "../src/app/[locale]/(admin)/admin/soirees/evenings";
import { type Answers, isProfileComplete } from "../src/app/[locale]/(membre)/espace/profil/profile";
import { type NextStepInput, nextStep, photoState, type UpcomingBooking } from "../src/components/member/nextStep";

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
