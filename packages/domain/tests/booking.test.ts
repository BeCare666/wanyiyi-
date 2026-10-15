import { describe, expect, it } from "vitest";
import {
  type Booker,
  CapacityError,
  canConfirm,
  cancelRegistration,
  confirmationDeadline,
  decideBooking,
  defaultCapacity,
  type Evening,
  type Registration,
  releaseUnconfirmed,
  seatsLeft,
  validateCapacity,
  waitlist,
} from "../src/booking";
import { cotonouDate } from "../src/time";

const startsAt = cotonouDate(2026, 10, 22, 19, 30);
const evening: Evening = { startsAt, capacity: { female: 2, male: 2 } };
const now = cotonouDate(2026, 10, 15, 12, 0);

const booker = (over: Partial<Booker> = {}): Booker => ({
  memberId: "afiwa",
  sex: "female",
  verification: "validated",
  birthDate: "1996-04-12",
  inCoupleSpace: false,
  ...over,
});

const reg = (memberId: string, sex: Registration["sex"], status: Registration["status"], minutes: number): Registration => ({
  memberId,
  sex,
  status,
  createdAt: new Date(now.getTime() + minutes * 60_000),
});

describe("Capacité (9.2)", () => {
  it("10 × 10 par défaut, 12 au maximum par sexe", () => {
    expect(defaultCapacity).toEqual({ female: 10, male: 10 });
    expect(validateCapacity({ female: 12, male: 12 })).toBeTruthy();
    expect(() => validateCapacity({ female: 13, male: 10 })).toThrow(CapacityError);
    expect(() => validateCapacity({ female: 10, male: 0 })).toThrow(CapacityError);
  });
});

describe("Réservation (9.2)", () => {
  it("seuls les membres validés peuvent réserver", () => {
    for (const verification of ["pending", "to_correct", "rejected"] as const) {
      expect(decideBooking(booker({ verification }), evening, [], now)).toEqual({ ok: false, reason: "not_validated" });
    }
    expect(decideBooking(booker(), evening, [], now)).toEqual({ ok: true, outcome: "seat" });
  });

  it("quotas séparés par sexe : places pleines chez les femmes, liste d'attente ; places libres chez les hommes", () => {
    const regs = [reg("a", "female", "booked", 0), reg("b", "female", "confirmed", 1)];
    expect(seatsLeft(evening, regs, "female")).toBe(0);
    expect(seatsLeft(evening, regs, "male")).toBe(2);
    expect(decideBooking(booker({ memberId: "c" }), evening, regs, now)).toEqual({ ok: true, outcome: "waitlist" });
    expect(decideBooking(booker({ memberId: "koffi", sex: "male" }), evening, regs, now)).toEqual({ ok: true, outcome: "seat" });
  });

  it("refuse une double inscription, une soirée commencée, l'exclusivité du couple et un retour anticipé", () => {
    const regs = [reg("afiwa", "female", "waitlisted", 0)];
    expect(decideBooking(booker(), evening, regs, now)).toMatchObject({ reason: "already_registered" });
    expect(decideBooking(booker(), evening, [], startsAt)).toMatchObject({ reason: "evening_closed" });
    expect(decideBooking(booker({ inCoupleSpace: true }), evening, [], now)).toMatchObject({ reason: "couple_exclusivity" });
    const blocked = booker({ eveningsBlockedUntil: cotonouDate(2026, 11, 1) });
    expect(decideBooking(blocked, evening, [], now)).toMatchObject({ reason: "blocked_until" });
  });

  it("soirées thématiques : tranche d'âge (calculée le jour de la soirée), foi, secteur", () => {
    const themed = (theme: Evening["theme"]): Evening => ({ ...evening, theme });
    // Née le 23 octobre 1991 : 34 ans le 22 octobre 2026, 35 ans le lendemain
    const b = booker({ birthDate: "1991-10-23", religion: "catholic", sector: "health" });
    expect(decideBooking(b, themed({ ageMin: 25, ageMax: 34 }), [], now)).toMatchObject({ ok: true });
    expect(decideBooking(b, themed({ ageMin: 35, ageMax: 45 }), [], now)).toMatchObject({ reason: "theme_age" });
    expect(decideBooking(b, themed({ religions: ["muslim"] }), [], now)).toMatchObject({ reason: "theme_religion" });
    expect(decideBooking(b, themed({ religions: ["catholic", "protestant_evangelical"] }), [], now)).toMatchObject({ ok: true });
    expect(decideBooking(b, themed({ sectors: ["education"] }), [], now)).toMatchObject({ reason: "theme_sector" });
  });
});

describe("Confirmation 48 h avant et liste d'attente (9.2)", () => {
  const deadline = confirmationDeadline(startsAt);

  it("la limite tombe 48 h avant le début", () => {
    expect(startsAt.getTime() - deadline.getTime()).toBe(48 * 3_600_000);
    const r = reg("a", "female", "booked", 0);
    expect(canConfirm(r, evening, new Date(deadline.getTime() - 1))).toBe(true);
    expect(canConfirm(r, evening, deadline)).toBe(false);
  });

  it("la liste d'attente suit l'ordre d'arrivée, par sexe", () => {
    const regs = [reg("w2", "female", "waitlisted", 5), reg("m1", "male", "waitlisted", 1), reg("w1", "female", "waitlisted", 2)];
    expect(waitlist(regs, "female").map((r) => r.memberId)).toEqual(["w1", "w2"]);
  });

  it("sans confirmation à la limite, la place passe au premier de la liste d'attente du même sexe", () => {
    const regs = [
      reg("a", "female", "confirmed", 0),
      reg("b", "female", "booked", 1),
      reg("w1", "female", "waitlisted", 2),
      reg("w2", "female", "waitlisted", 3),
      reg("m1", "male", "booked", 4),
      reg("mw", "male", "waitlisted", 5),
    ];
    const male: Evening = { ...evening, capacity: { female: 2, male: 1 } };
    const before = releaseUnconfirmed(male, regs, new Date(deadline.getTime() - 1));
    expect(before.find((r) => r.memberId === "b")?.status).toBe("booked");

    const after = releaseUnconfirmed(male, regs, deadline);
    const status = (id: string) => after.find((r) => r.memberId === id)?.status;
    expect(status("a")).toBe("confirmed");
    expect(status("b")).toBe("released");
    expect(status("w1")).toBe("booked");
    expect(status("w2")).toBe("waitlisted");
    expect(status("m1")).toBe("released");
    expect(status("mw")).toBe("booked");
  });

  it("une annulation libère la place pour la liste d'attente du même sexe uniquement", () => {
    const regs = [reg("a", "female", "confirmed", 0), reg("b", "female", "confirmed", 1), reg("w1", "female", "waitlisted", 2), reg("mw", "male", "waitlisted", 3)];
    const full: Evening = { ...evening, capacity: { female: 2, male: 2 } };
    const after = cancelRegistration(full, regs, "a", now);
    expect(after.find((r) => r.memberId === "a")?.status).toBe("cancelled");
    expect(after.find((r) => r.memberId === "w1")?.status).toBe("booked");
    // Places hommes libres : le membre en attente est aussi servi
    expect(after.find((r) => r.memberId === "mw")?.status).toBe("booked");
  });
});
