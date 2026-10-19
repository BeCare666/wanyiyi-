import QRCode from "qrcode";
import type { EventStatus } from "./evenings";

/**
 * Adresse contenue dans le code QR d'une table (question 20, 19 octobre 2026) :
 * <NEXT_PUBLIC_SITE_URL>/vote/<code>, ouverte par la page de vote (9.3).
 */
export function voteUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/vote/${token}`;
}

/**
 * Codes imprimables une fois les tables préparées, jusqu'à la fin de la soirée
 * (le code n'est valable que pendant la soirée).
 */
export function canPrintTables(status: EventStatus, prepared: boolean): boolean {
  return prepared && (status === "published" || status === "full" || status === "in_progress");
}

/**
 * Dessin du code QR en un seul chemin SVG (un carré par module sombre), peint ensuite en
 * currentColor : aucune couleur en dur. Correction d'erreur M : lisible malgré un pli ou une tache.
 */
export function qrPath(text: string): { size: number; path: string } {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  let path = "";
  for (let y = 0; y < modules.size; y++) {
    for (let x = 0; x < modules.size; x++) {
      if (modules.get(y, x)) path += `M${x} ${y}h1v1h-1z`;
    }
  }
  return { size: modules.size, path };
}
