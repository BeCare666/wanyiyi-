import { RULES } from "@wanyiyi/shared";

/**
 * Blocage des coordonnées dans les textes libres du profil (section 8.1) :
 * numéros de téléphone (y compris en lettres ou avec espaces), liens, adresses e-mail
 * et pseudos de réseaux sociaux. Appliqué à la saisie et côté serveur.
 * Les textes passent ensuite en relecture par l'équipe : ce filtre ne la remplace pas.
 * Copie dans la base : app.text_contact_issues (migration 20261026000100_filtre_textes.sql),
 * à modifier en même temps ; supabase/tests/filtre-textes.test.ts compare les deux.
 */

export type TextIssue = "too_long" | "phone" | "email" | "link" | "social_handle";

/** Chiffres écrits en lettres : français, anglais et yoruba (sans accents ; liste yoruba à valider). */
const DIGIT_WORDS: Record<string, string> = {
  zero: "0", un: "1", une: "1", deux: "2", trois: "3", quatre: "4", cinq: "5", six: "6", sept: "7", huit: "8", neuf: "9",
  oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", seven: "7", eight: "8", nine: "9",
  odo: "0", okan: "1", eji: "2", eta: "3", erin: "4", arun: "5", efa: "6", eje: "7", ejo: "8", esan: "9",
};

/** Nombres de 10 à 99 en français, pour « zéro un quatre-vingt-dix-sept… ». */
const FR_TEENS: Record<string, number> = { dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16 };
const FR_TENS: Record<string, number> = { vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60 };

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Remplace les nombres écrits en lettres par leurs chiffres. */
function wordsToDigits(text: string): string {
  const tokens = stripAccents(text.toLowerCase()).split(/([^a-z0-9]+)/);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i] ?? "";
    // « quatre-vingt(s) » et « soixante » suivis d'un complément (dix, onze… dix-neuf ou unité)
    let tens: number | undefined;
    let consumed = 0;
    if (tok === "quatre" && /^-\s*$/.test(tokens[i + 1] ?? "") && /^vingts?$/.test(tokens[i + 2] ?? "")) {
      tens = 80;
      consumed = 2;
    } else if (FR_TENS[tok] !== undefined) {
      tens = FR_TENS[tok];
    }
    if (tens !== undefined) {
      let j = i + consumed + 1;
      let rest = 0;
      // Séparateur puis éventuellement « et », puis unité, dizaine (dix…seize) ou « dix-sept/huit/neuf »
      const next = () => {
        while (j < tokens.length && /^[^a-z0-9]+$/.test(tokens[j] ?? "")) j++;
        return tokens[j] ?? "";
      };
      let word = next();
      if (word === "et") {
        j++;
        word = next();
      }
      const teen = FR_TEENS[word];
      if (teen !== undefined) {
        rest = teen;
        j++;
        if (word === "dix") {
          const unit = next();
          if (["sept", "huit", "neuf"].includes(unit)) {
            rest += Number(DIGIT_WORDS[unit]);
            j++;
          }
        }
      } else if (DIGIT_WORDS[word] !== undefined && word !== "zero") {
        rest = Number(DIGIT_WORDS[word]);
        j++;
      }
      out.push(String(tens + rest));
      i = j - 1;
      continue;
    }
    const teen = FR_TEENS[tok];
    if (teen !== undefined) {
      out.push(String(teen));
      continue;
    }
    out.push(DIGIT_WORDS[tok] ?? tok);
  }
  return out.join("");
}

const EMAIL = /[a-z0-9._%+-]+\s*(?:@|\(at\)|\[at\]|\s+at\s+|\s+arobase\s+)\s*[a-z0-9-]+\s*(?:\.|\(dot\)|\[dot\]|\s+dot\s+|\s+point\s+)\s*[a-z]{2,}/i;
const LINK = /(?:https?:\/\/|www\.)\S+|\bwa\.me\b|\b[a-z0-9-]+\.(?:com|net|org|bj|fr|me|io|co|info|biz|africa|link|ly)\b/i;
const HANDLE = /(?:^|[\s(])@[a-z0-9._]{2,}/i;
const NETWORK_HANDLE =
  /\b(?:insta(?:gram)?|ig|snap(?:chat)?|tik\s?tok|facebook|fb|telegram|whats\s?app|twitter|linkedin)\s*(?::|=|->|@)\s*\S+/i;

/** Suite d'au moins 8 chiffres, séparateurs usuels compris (espaces, points, tirets, parenthèses, « + »). */
function containsPhone(text: string): boolean {
  const digits = wordsToDigits(text)
    // Lettre « o » collée à des chiffres : 0
    .replace(/(?<=\d)[oO]|[oO](?=\d)/g, "0");
  const compact = digits.replace(/(?<=[\d+])[\s.\-/()_,]+(?=[\d(])/g, "");
  return /\d{8,}/.test(compact);
}

export function checkFreeText(text: string): TextIssue[] {
  const issues: TextIssue[] = [];
  if (text.length > RULES.profile.freeTextMaxLength) issues.push("too_long");
  if (EMAIL.test(text)) issues.push("email");
  if (LINK.test(text)) issues.push("link");
  if (HANDLE.test(text) || NETWORK_HANDLE.test(text)) issues.push("social_handle");
  if (containsPhone(text)) issues.push("phone");
  return issues;
}
