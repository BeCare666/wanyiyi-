import localFont from "next/font/local";

/*
 * Polices hébergées dans le projet (src/fonts), licence SIL Open Font License.
 * Sous-ensembles : latin, latin étendu, diacritiques combinants et Latin Extended Additional,
 * ce qui couvre le français, l'anglais et le yoruba (ẹ, ọ, ṣ, point souscrit, accents tonals).
 * Couverture vérifiée sur la table des caractères des fichiers.
 * Axe de graisse limité aux graisses utilisées.
 *
 * Choix vérifiés par rendu dans Chromium :
 * - Jost (proposée par la note) a été écartée : elle ne contient pas ẹ, ọ ni ṣ.
 * - Cormorant Garamond (proposée par la note) a été écartée : ses accents sont mal placés
 *   (ô, ù, é décalés), y compris dans le fichier d'origine de Google Fonts.
 * - EB Garamond, serif équivalente, place correctement tous les accents français et yoruba.
 */
export const display = localFont({
  src: [
    { path: "../fonts/eb-garamond.woff2", weight: "400 500", style: "normal" },
    { path: "../fonts/eb-garamond-italic.woff2", weight: "400 500", style: "italic" },
  ],
  variable: "--font-display",
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
});

export const text = localFont({
  src: [{ path: "../fonts/montserrat.woff2", weight: "300 500", style: "normal" }],
  variable: "--font-text",
  display: "swap",
  fallback: ["system-ui", "Segoe UI", "sans-serif"],
});
