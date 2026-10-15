import { describe, expect, it } from "vitest";
import { DEFAULT_CAPACITY_PER_SEX, demoUpcomingEvenings, MAX_CAPACITY_PER_SEX, seatsLeft } from "../src/lib/evenings";

describe("Places restantes", () => {
  it("calcule la différence entre capacité et réservations", () => {
    expect(seatsLeft(10, 7)).toBe(3);
  });

  it("ne descend jamais sous zéro", () => {
    expect(seatsLeft(10, 12)).toBe(0);
  });
});

describe("Soirées de démonstration", () => {
  // Lundi 13 octobre 2026, 10 h à Cotonou
  const now = new Date("2026-10-13T09:00:00Z");
  const evenings = demoUpcomingEvenings(now);

  it("sont toutes dans le futur et triées par date", () => {
    const dates = evenings.map((e) => new Date(e.startsAt).getTime());
    expect(dates.every((d) => d > now.getTime())).toBe(true);
    expect([...dates].sort((a, b) => a - b)).toEqual(dates);
  });

  it("commencent à 19 h 30, heure de Cotonou (18 h 30 UTC)", () => {
    for (const e of evenings) expect(e.startsAt).toMatch(/T18:30:00\.000Z$/);
  });

  it("respectent la capacité par défaut et le maximum de 12 par sexe", () => {
    for (const e of evenings) {
      expect(e.capacityWomen).toBe(DEFAULT_CAPACITY_PER_SEX);
      expect(e.capacityMen).toBe(DEFAULT_CAPACITY_PER_SEX);
      expect(e.capacityWomen).toBeLessThanOrEqual(MAX_CAPACITY_PER_SEX);
    }
  });

  it("ne dépassent pas trois soirées par semaine", () => {
    const perWeek = new Map<number, number>();
    for (const e of evenings) {
      const week = Math.floor((new Date(e.startsAt).getTime() - now.getTime()) / (7 * 864e5));
      perWeek.set(week, (perWeek.get(week) ?? 0) + 1);
    }
    for (const count of perWeek.values()) expect(count).toBeLessThanOrEqual(3);
  });
});
