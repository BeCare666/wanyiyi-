import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import fr from "../messages/fr.json";
import yo from "../messages/yo.json";
import { adminNav } from "../src/components/admin/adminNav";

/**
 * Accueil de l'administration : chaque module du menu a son nom, sa description et son groupe dans
 * les trois langues (les clés sont composées dans le code : t(`navHelp.${key}`)).
 */
describe("accueil de l'administration", () => {
  for (const [locale, messages] of Object.entries({ fr, en, yo })) {
    it(`nom, description et groupe de chaque module en ${locale}`, () => {
      const admin = messages.Admin as unknown as { nav: Record<string, string>; navHelp: Record<string, string>; groups: Record<string, string> };
      for (const group of adminNav) {
        expect(admin.groups[group.key], `groups.${group.key}`).toBeTruthy();
        for (const item of group.items) {
          expect(admin.nav[item.key], `nav.${item.key}`).toBeTruthy();
          expect(admin.navHelp[item.key], `navHelp.${item.key}`).toBeTruthy();
        }
      }
    });
  }
});
