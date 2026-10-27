import { describe, expect, it } from "vitest";
import {
  automaticChoices,
  canChooseMatch,
  canRequestExtension,
  CLOSED_MESSAGE,
  type Discovery,
  discoveriesClosedByCouple,
  discoveryEndsAt,
  discoveryOutcome,
  freeSlots,
  isPendingExpired,
  type PendingMatch,
  pendingExpiresAt,
  shouldOpen,
} from "../src/discovery";
import { cotonouDate } from "../src/time";

const DAY = 86_400_000;
const announced = cotonouDate(2026, 10, 23, 8, 0);
const later = (days: number) => new Date(announced.getTime() + days * DAY);

const discovery = (id: string, a: string, b: string, status: Discovery["status"] = "active", extended = false): Discovery => ({
  id,
  matchId: `m-${id}`,
  members: [a, b],
  status,
  openedAt: announced,
  extended,
});

const match = (chosenBy: string[] = [], status: PendingMatch["status"] = "pending"): PendingMatch => ({
  id: "m",
  members: ["afiwa", "koffi"],
  status,
  announcedAt: announced,
  chosenBy,
});

describe("Découverte 9.4 : places et ouverture (question 2)", () => {
  it("2 découvertes actives au plus par membre", () => {
    const list = [discovery("1", "afiwa", "dossou"), discovery("2", "afiwa", "kodjo", "extended"), discovery("3", "afiwa", "yao", "closed")];
    expect(freeSlots("afiwa", list)).toBe(0);
    expect(freeSlots("dossou", list)).toBe(1);
    expect(freeSlots("sena", list)).toBe(2);
  });

  it("à l'annonce : choisis d'office s'ils tiennent dans les places, sinon choix du membre", () => {
    expect(automaticChoices(["m1", "m2"], 2)).toEqual(["m1", "m2"]);
    expect(automaticChoices(["m1", "m2", "m3"], 2)).toEqual([]);
    expect(automaticChoices(["m1"], 0)).toEqual([]);
    expect(automaticChoices([], 0)).toEqual([]);
  });

  it("ouverture seulement si les deux ont choisi et ont une place", () => {
    expect(shouldOpen(match(["afiwa"]), [])).toBe(false);
    expect(shouldOpen(match(["afiwa", "koffi"]), [])).toBe(true);
    const full = [discovery("1", "koffi", "sena"), discovery("2", "koffi", "ablavi")];
    expect(shouldOpen(match(["afiwa", "koffi"]), full)).toBe(false);
  });

  it("choix refusé : sans place, déjà choisi, hors du match, expiré, en couple", () => {
    const ctx = { now: later(1), discoveries: [] as Discovery[], inCouple: false };
    expect(canChooseMatch(match(), "afiwa", ctx)).toBeNull();
    expect(canChooseMatch(match(["afiwa"]), "afiwa", ctx)).toBe("already_chosen");
    expect(canChooseMatch(match(), "sena", ctx)).toBe("not_member");
    expect(canChooseMatch(match([], "open"), "afiwa", ctx)).toBe("not_pending");
    expect(canChooseMatch(match(), "afiwa", { ...ctx, now: later(7) })).toBe("expired");
    expect(canChooseMatch(match(), "afiwa", { ...ctx, inCouple: true })).toBe("couple_exclusivity");
    const full = [discovery("1", "afiwa", "dossou"), discovery("2", "afiwa", "kodjo")];
    expect(canChooseMatch(match(), "afiwa", { ...ctx, discoveries: full })).toBe("no_free_slot");
    // Une place libérée permet de choisir pendant l'attente
    expect(canChooseMatch(match(), "afiwa", { ...ctx, discoveries: [full[0]!, { ...full[1]!, status: "closed" }] })).toBeNull();
  });

  it("attente de 7 jours après l'annonce, puis expiration", () => {
    expect(pendingExpiresAt(match()).getTime()).toBe(later(7).getTime());
    expect(isPendingExpired(match(), new Date(later(7).getTime() - 1))).toBe(false);
    expect(isPendingExpired(match(), later(7))).toBe(true);
    expect(isPendingExpired(match([], "open"), later(30))).toBe(false);
  });
});

describe("Découverte 9.4 : déroulement et fin", () => {
  const d = discovery("d", "afiwa", "koffi");
  const decide = (continueA: boolean, continueB: boolean, extA = false, extB = false) => [
    { memberId: "afiwa", wantsToContinue: continueA, wantsExtension: extA },
    { memberId: "koffi", wantsToContinue: continueB, wantsExtension: extB },
  ];

  it("prolongation demandable seulement pendant les 4 derniers jours (question 3)", () => {
    expect(canRequestExtension(d, later(9))).toBe(false);
    expect(canRequestExtension(d, later(10))).toBe(true);
    expect(canRequestExtension(d, later(13.9))).toBe(true);
    expect(canRequestExtension(d, later(14))).toBe(false);
    expect(canRequestExtension({ ...d, extended: true }, later(12))).toBe(false);
  });

  it("14 jours, 21 avec la prolongation", () => {
    expect(discoveryEndsAt(d).getTime()).toBe(later(14).getTime());
    expect(discoveryEndsAt({ ...d, extended: true }).getTime()).toBe(later(21).getTime());
  });

  it("couple seulement si les deux veulent continuer", () => {
    expect(discoveryOutcome(d, decide(true, true), later(3))).toBe("couple");
    expect(discoveryOutcome(d, decide(true, false), later(3))).toBe("none");
  });

  it("une seule prolongation, demandée par les deux", () => {
    expect(discoveryOutcome(d, decide(false, false, true, false), later(10))).toBe("none");
    expect(discoveryOutcome(d, decide(false, false, true, true), later(10))).toBe("extend");
    expect(discoveryOutcome({ ...d, extended: true, status: "extended" }, decide(false, false, true, true), later(15))).toBe("none");
  });

  it("fermeture sans décision à l'échéance (14 jours, ou 21 après prolongation)", () => {
    expect(discoveryOutcome(d, decide(false, false), later(14))).toBe("close");
    expect(discoveryOutcome({ ...d, extended: true, status: "extended" }, decide(false, false), later(14))).toBe("none");
    expect(discoveryOutcome({ ...d, extended: true, status: "extended" }, decide(true, false), later(21))).toBe("close");
    expect(discoveryOutcome({ ...d, status: "closed" }, decide(true, true), later(3))).toBe("none");
  });

  it("le couple ferme les autres découvertes des deux, et seulement elles", () => {
    const list = [d, discovery("x", "afiwa", "dossou"), discovery("y", "sena", "koffi", "extended"), discovery("z", "sena", "yao"), discovery("w", "afiwa", "kodjo", "closed")];
    expect(discoveriesClosedByCouple(d, list)).toEqual(["x", "y"]);
  });

  it("message unique et neutre", () => {
    expect(CLOSED_MESSAGE).toBe("Cette mise en relation est terminée.");
  });
});
