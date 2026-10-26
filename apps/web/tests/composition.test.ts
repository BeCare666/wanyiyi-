import { describe, expect, it } from "vitest";
import { type CompositionAlert, involvedCount, showComposition, splitAlerts } from "../src/app/[locale]/(admin)/admin/soirees/composition";

/** Composition assistée (section 11.2-5 de la note). */

const alert = (holder: string, other: string, kind: CompositionAlert["kind"]): CompositionAlert => ({
  holder_id: holder,
  holder_number: null,
  holder_first_name: holder,
  holder_sex: "female",
  other_id: other,
  other_number: null,
  other_first_name: other,
  category: "tobacco",
  sought: ["no"],
  declared: kind === "unknown" ? null : ["yes"],
  kind,
});

describe("Composition assistée", () => {
  it("affichée tant que la soirée peut être composée", () => {
    expect(showComposition("published")).toBe(true);
    expect(showComposition("full")).toBe(true);
    expect(showComposition("in_progress")).toBe(true);
    expect(showComposition("draft")).toBe(false);
    expect(showComposition("finished")).toBe(false);
    expect(showComposition("cancelled")).toBe(false);
  });

  it("incompatibilités séparées des réponses manquantes ; personnes concernées comptées une fois", () => {
    const alerts = [alert("Afiwa", "Codjo", "incompatible"), alert("Kémi", "Codjo", "incompatible"), alert("Afiwa", "Yao", "unknown")];
    expect(splitAlerts(alerts).incompatible).toHaveLength(2);
    expect(splitAlerts(alerts).unknown).toHaveLength(1);
    expect(involvedCount(alerts)).toBe(3);
  });
});
