import { defineConfig } from "vitest/config";

// PGlite démarre une base complète par fichier de test : délais larges sur un poste lent
export default defineConfig({
  test: { testTimeout: 60_000, hookTimeout: 180_000 },
});
