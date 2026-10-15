import { describe, expect, it } from "vitest";
import { buildRotation, RotationError, tableOfMan } from "../src/rotation";
import { breakAfterRound, buildSchedule, currentSlot } from "../src/schedule";

/** Ensemble des rencontres « femme-homme » de toute la soirée. */
function allMeetings(women: number, men: number) {
  return buildRotation(women, men).flatMap((r) => r.meetings.map((m) => `${m.woman}-${m.man}`));
}

describe("Rotation (9.2)", () => {
  it("10 × 10 : 10 tours, chaque femme rencontre chaque homme exactement une fois", () => {
    const rounds = buildRotation(10, 10);
    expect(rounds).toHaveLength(10);
    const meetings = allMeetings(10, 10);
    expect(meetings).toHaveLength(100);
    expect(new Set(meetings).size).toBe(100);
    expect(rounds.every((r) => r.pauses.length === 0)).toBe(true);
  });

  it("les femmes restent à leur table, l'homme n° m commence à la table m", () => {
    const [first, second] = buildRotation(10, 10);
    for (const seat of first!.seats) {
      expect(seat.woman).toBe(seat.table);
      expect(seat.man).toBe(seat.table);
    }
    // Au tour 2, l'homme 1 est à la table 2 et l'homme 10 revient à la table 1
    expect(second!.seats.find((s) => s.man === 1)?.table).toBe(2);
    expect(second!.seats.find((s) => s.man === 10)?.table).toBe(1);
  });

  it("chaque homme avance d'une table par tour et revient à la table 1 après la table N", () => {
    expect([1, 2, 3, 4, 5].map((r) => tableOfMan(4, r, 5))).toEqual([4, 5, 1, 2, 3]);
  });

  it("12 × 12 (maximum) : toutes les paires une fois", () => {
    const meetings = allMeetings(12, 12);
    expect(meetings).toHaveLength(144);
    expect(new Set(meetings).size).toBe(144);
  });

  it("nombre inégal (10 femmes, 8 hommes) : 10 tours, deux femmes en pause à chaque tour", () => {
    const rounds = buildRotation(10, 8);
    expect(rounds).toHaveLength(10);
    expect(rounds.every((r) => r.pauses.length === 2 && r.pauses.every((p) => p.sex === "female"))).toBe(true);
    const meetings = allMeetings(10, 8);
    expect(new Set(meetings).size).toBe(80);
    // Chaque femme a exactement deux tours de pause
    const pausesByWoman = new Map<number, number>();
    rounds.flatMap((r) => r.pauses).forEach((p) => pausesByWoman.set(p.number, (pausesByWoman.get(p.number) ?? 0) + 1));
    expect([...pausesByWoman.values()].every((n) => n === 2)).toBe(true);
  });

  it("nombre inégal (7 femmes, 9 hommes) : les hommes aux tables 8 et 9 sont en pause", () => {
    const rounds = buildRotation(7, 9);
    expect(rounds).toHaveLength(9);
    expect(rounds.every((r) => r.pauses.length === 2 && r.pauses.every((p) => p.sex === "male" && p.table > 7))).toBe(true);
    expect(new Set(allMeetings(7, 9)).size).toBe(63);
  });

  it("refuse plus de 12 participants par sexe ou un nombre nul", () => {
    expect(() => buildRotation(13, 10)).toThrow(RotationError);
    expect(() => buildRotation(10, 0)).toThrow(RotationError);
  });
});

describe("Minuteur (9.2)", () => {
  const start = new Date("2026-10-22T18:30:00Z");

  it("tours de 7 minutes, changements de 1 minute, pause après la moitié des tours", () => {
    const slots = buildSchedule({ start, rounds: 10, breakMinutes: 15 });
    const rounds = slots.filter((s) => s.kind === "round");
    expect(rounds).toHaveLength(10);
    expect(rounds.every((s) => s.end.getTime() - s.start.getTime() === 7 * 60_000)).toBe(true);
    const breaks = slots.filter((s) => s.kind === "break");
    expect(breaks).toHaveLength(1);
    expect(breaks[0]).toMatchObject({ afterRound: 5 });
    expect(slots.filter((s) => s.kind === "changeover")).toHaveLength(8);
    // 10 × 7 + 8 × 1 + 15 = 93 minutes
    expect(slots.at(-1)!.end.getTime() - start.getTime()).toBe(93 * 60_000);
  });

  it("le créneau en cours suit l'horloge", () => {
    const slots = buildSchedule({ start, rounds: 4, breakMinutes: 10 });
    expect(currentSlot(slots, new Date(start.getTime() - 1))).toBeNull();
    expect(currentSlot(slots, new Date(start.getTime() + 3 * 60_000))).toMatchObject({ kind: "round", round: 1 });
    expect(currentSlot(slots, new Date(start.getTime() + 7.5 * 60_000))).toMatchObject({ kind: "changeover" });
    expect(breakAfterRound(4)).toBe(2);
  });
});
