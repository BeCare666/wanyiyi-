import { describe, expect, it } from "vitest";
import { JOURNEY_KINDS } from "../src/notifications/journey-messages";
import { deliveryContent } from "../src/notifications/team-messages";

/** Une notification à chaque étape du parcours (audit UX du 3 novembre 2026) : e-mail dans les 3 langues. */

const origin = "https://ifedele.com";

describe("E-mails des étapes du parcours", () => {
  it("chaque étape a un e-mail dans chaque langue, avec le lien vers l'étape suivante", () => {
    for (const kind of JOURNEY_KINDS) {
      for (const locale of ["fr", "en", "yo"]) {
        const content = deliveryContent(kind, { starts_at: "2026-11-14T18:30:00Z", priced: true }, locale, origin);
        expect(content, `${kind} ${locale}`).not.toBeNull();
        expect(content!.email.subject.length).toBeGreaterThan(5);
        expect(content!.email.html).toContain(origin);
        expect(content!.email.text).not.toContain("{date}");
        expect(content!.email.text).not.toContain("—");
      }
    }
  });

  it("réservation : date de la soirée, paiement pour une soirée payante, confirmation pour une gratuite", () => {
    const paid = deliveryContent("evening.booked", { starts_at: "2026-11-14T18:30:00Z", priced: true }, "fr", origin)!;
    expect(paid.email.text).toContain("14 novembre");
    expect(paid.email.text).toContain("le paiement la confirme");
    expect(paid.email.html).toContain("/espace/soirees?filtre=mine");

    const free = deliveryContent("evening.booked", { starts_at: "2026-11-14T18:30:00Z", priced: false }, "fr", origin)!;
    expect(free.email.text).toContain("gratuite");
    expect(free.email.text).not.toContain("Payez");
  });

  it("sans date (donnée absente) : phrase correcte, sans trou", () => {
    const content = deliveryContent("evening.confirmed", {}, "fr", origin)!;
    expect(content.email.text).toContain("Votre place pour la soirée est confirmée.");
  });
});
