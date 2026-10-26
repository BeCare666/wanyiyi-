/** Ligne de app.admin_list('moderation') : texte de profil en attente de relecture. */
export type ModerationRow = {
  text_id: string;
  user_id: string;
  first_name: string | null;
  member_number: string | null;
  field: "who_i_am" | "what_matters" | "evening_topic";
  body: string;
  created_at: string;
  total: number;
};

/** Colonnes du fichier exporté de la file de modération (11.3). */
export const moderationExportColumns = ["member_number", "first_name", "field", "body", "created_at"] as const;
export type ModerationExportColumn = (typeof moderationExportColumns)[number];

export function moderationExportCell(
  row: ModerationRow,
  column: ModerationExportColumn,
  labels: { field: (f: string) => string; date: (iso: string) => string },
): string | number | null {
  switch (column) {
    case "member_number":
      return row.member_number;
    case "first_name":
      return row.first_name;
    case "field":
      return labels.field(row.field);
    case "body":
      return row.body;
    case "created_at":
      return labels.date(row.created_at);
  }
}
