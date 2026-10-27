import { describe, expect, it } from "vitest";
import { NOTE_MAX, noteBody } from "../src/app/[locale]/(conseiller)/conseiller/counselor";

/** Espace conseiller (section 7) : notes privées. */

describe("notes privées du conseiller", () => {
  it("texte non vide de 4 000 caractères au plus, espaces retirés", () => {
    expect(noteBody("  Premier échange serein.  ")).toBe("Premier échange serein.");
    expect(noteBody("   ")).toBeNull();
    expect(noteBody("a".repeat(NOTE_MAX))).toHaveLength(NOTE_MAX);
    expect(noteBody("a".repeat(NOTE_MAX + 1))).toBeNull();
    expect(noteBody(42)).toBeNull();
  });
});
