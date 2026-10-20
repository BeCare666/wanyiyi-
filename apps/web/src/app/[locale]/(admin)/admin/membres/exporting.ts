import ExcelJS from "exceljs";
import type { MemberColumn } from "./filters";
import type { MemberRow } from "./members";

/** Formats d'export (11.3) ; Excel par la bibliothèque exceljs (décision du 19 octobre 2026). */
export const exportFormats = ["csv", "xlsx"] as const;
export type ExportFormat = (typeof exportFormats)[number];

/** Colonnes d'un fichier exporté : identité, puis les colonnes affichées. */
export type ExportColumn = "member_number" | "first_name" | "last_name" | "status" | "role" | "sex" | "age" | "city" | "phone" | "evenings_attended" | "matches" | "joined";

/**
 * Colonnes du fichier : numéro et nom toujours, puis celles de la liste (« activité » en deux
 * colonnes). Le téléphone n'apparaît que pour la super administration (question 23) ; la base
 * le retire de toute façon des autres exports.
 */
export function exportColumns(columns: readonly MemberColumn[], superAdmin: boolean): ExportColumn[] {
  const out: ExportColumn[] = ["member_number", "first_name", "last_name"];
  for (const c of columns) {
    if (c === "activity") out.push("evenings_attended", "matches");
    else if (c === "phone") {
      if (superAdmin) out.push("phone");
    } else out.push(c);
  }
  return out;
}

export type ExportLabels = {
  header: (column: ExportColumn) => string;
  status: (status: string) => string;
  role: (role: string) => string;
  sex: (sex: string) => string;
  date: (iso: string) => string;
  age: (birthDate: string) => number;
};

/** Valeur d'une cellule : texte, nombre ou vide. */
export function exportCell(row: MemberRow, column: ExportColumn, labels: ExportLabels): string | number | null {
  switch (column) {
    case "member_number":
      return row.member_number;
    case "first_name":
      return row.first_name;
    case "last_name":
      return row.last_name;
    case "status":
      return row.status ? labels.status(row.status) : null;
    case "role":
      return labels.role(row.role);
    case "sex":
      return row.sex ? labels.sex(row.sex) : null;
    case "age":
      return row.birth_date ? labels.age(row.birth_date) : null;
    case "city":
      return row.city;
    case "phone":
      return row.phone;
    case "evenings_attended":
      return row.evenings_attended;
    case "matches":
      return row.matches;
    case "joined":
      return labels.date(row.created_at);
  }
}

export function exportTable(rows: readonly MemberRow[], columns: readonly ExportColumn[], labels: ExportLabels): Array<Array<string | number | null>> {
  return [columns.map((c) => labels.header(c)), ...rows.map((row) => columns.map((c) => exportCell(row, c, labels)))];
}

/**
 * Cellule CSV : entre guillemets si nécessaire. Un texte qui commence par =, +, -, @ ou une
 * tabulation est précédé d'une apostrophe, pour qu'un tableur ne l'exécute pas comme formule.
 */
export function csvCell(value: string | number | null): string {
  if (value === null) return "";
  if (typeof value === "number") return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Fichier CSV (UTF-8 avec marque d'ordre, lu correctement par les tableurs ; fins de ligne CRLF). */
export function toCsv(table: ReadonlyArray<ReadonlyArray<string | number | null>>): string {
  return "\uFEFF" + table.map((line) => line.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Nom du fichier : membres-AAAA-MM-JJ.csv (jour de Cotonou). */
export function exportFileName(format: ExportFormat, day: string): string {
  return `membres-${day}.${format}`;
}

/** Classeur Excel (exceljs) : ligne d'en-tête en gras et figée, largeurs ajustées au contenu. */
export async function toXlsx(table: ReadonlyArray<ReadonlyArray<string | number | null>>, sheetName: string): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31));
  sheet.addRows(table.map((line) => [...line]));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.columns.forEach((column, i) => {
    const longest = Math.max(...table.map((line) => String(line[i] ?? "").length));
    column.width = Math.min(Math.max(longest + 2, 10), 40);
  });
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}
