/**
 * Dossier de vérification (section 6.2-2, décisions du 17 octobre 2026).
 * Les mêmes règles sont appliquées par la base (app.submit_id_documents,
 * app.sign_honor_declaration) : ce module ne sert qu'à guider le membre avant l'envoi.
 */

/** Version du texte de la déclaration affiché (Member.verification.declaration.text). */
export const DECLARATION_VERSION = "v1";

export const maritalStatuses = ["single", "divorced", "widowed", "other"] as const;
export type MaritalStatus = (typeof maritalStatuses)[number];

/** Une seule pièce : carte et permis recto et verso, passeport page photo. */
export const documentKinds = ["id_card", "driving_licence", "passport"] as const;
export type DocumentKind = (typeof documentKinds)[number];

export const OTHER_DETAILS_MAX = 300;

/** Compartiment privé des pièces (10.1) et limites du compartiment (migration 20261017000100). */
export const BUCKET = "id-documents";
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const documentTypes: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export type FileSlot = "front" | "back" | "selfie";

/** Fichiers demandés pour une pièce, selfie compris. */
export function requiredSlots(kind: DocumentKind): FileSlot[] {
  return kind === "passport" ? ["front", "selfie"] : ["front", "back", "selfie"];
}

/** Erreur d'un fichier choisi (clé de traduction), ou null s'il convient. Le selfie est une photo. */
export function fileError(slot: FileSlot, file: { type: string; size: number }): "type" | "size" | null {
  const allowed = slot === "selfie" ? imageTypes.has(file.type) : file.type in documentTypes;
  if (!allowed) return "type";
  if (file.size > MAX_FILE_BYTES) return "size";
  return null;
}

/** Chemin dans le compartiment : le dossier du membre, puis un nom aléatoire (jamais le nom d'origine). */
export function storagePath(userId: string, type: string, randomId: string): string {
  return `${userId}/${randomId}.${documentTypes[type] ?? "bin"}`;
}

export type DeclarationInput = { status: string; hasChildren: boolean | null; otherDetails: string; certified: boolean };

/** Déclaration prête à signer, ou la clé de l'erreur à afficher. */
export function parseDeclaration(input: DeclarationInput):
  | { ok: true; value: { status: MaritalStatus; hasChildren: boolean; otherDetails: string | null } }
  | { ok: false; error: "status" | "children" | "otherDetails" | "certify" } {
  const status = maritalStatuses.find((s) => s === input.status);
  if (!status) return { ok: false, error: "status" };
  const other = input.otherDetails.trim();
  if (status === "other" && (other === "" || other.length > OTHER_DETAILS_MAX)) return { ok: false, error: "otherDetails" };
  if (input.hasChildren === null) return { ok: false, error: "children" };
  if (!input.certified) return { ok: false, error: "certify" };
  return { ok: true, value: { status, hasChildren: input.hasChildren, otherDetails: status === "other" ? other : null } };
}

/** Réponse de app.my_verification() (aucun chemin de fichier n'est jamais renvoyé). */
export type MyVerification = {
  status: "pending" | "to_correct" | "approved" | "rejected";
  correction_note: string | null;
  document_kind: DocumentKind | null;
  documents_at: string | null;
  has_selfie: boolean;
  declared_status: MaritalStatus | null;
  has_children: boolean | null;
  other_details: string | null;
  declaration_version: string | null;
  signed_at: string | null;
};

/** Le membre peut encore déposer ou signer : dossier non commencé, en attente ou à corriger. */
export function canSubmit(verification: MyVerification | null): boolean {
  return verification === null || verification.status === "pending" || verification.status === "to_correct";
}

/** Codes d'erreur de la base qui ont un texte dédié. */
export const knownVerificationErrors = new Set([
  "invalid_document_kind",
  "document_missing",
  "duplicate_file",
  "file_not_found",
  "invalid_declaration",
  "outdated_declaration",
  "verification_closed",
  "upload_failed",
  "unavailable",
]);
