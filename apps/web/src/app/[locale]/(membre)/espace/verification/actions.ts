"use server";

import type { ApiResult } from "@/lib/api";
import { createSupabaseServer } from "@/lib/supabase/server";
import { DECLARATION_VERSION, type DeclarationInput, type DocumentKind, documentKinds, parseDeclaration } from "./verification";

/** Erreur de la base : le code métier levé par la fonction SQL est le message. */
function failed(error: { message?: string } | null): ApiResult<void> {
  return { ok: false, error: error?.message ?? "generic" };
}

/** Signature de la déclaration sur l'honneur (texte en vigueur : DECLARATION_VERSION). */
export async function signDeclaration(input: DeclarationInput): Promise<ApiResult<void>> {
  const parsed = parseDeclaration(input);
  if (!parsed.ok) return { ok: false, error: "invalid_declaration" };
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { error } = await supabase.rpc("sign_honor_declaration", {
    p_status: parsed.value.status,
    p_has_children: parsed.value.hasChildren,
    p_other_details: parsed.value.otherDetails,
    p_version: DECLARATION_VERSION,
  });
  return error ? failed(error) : { ok: true, data: undefined };
}

/**
 * Enregistre la pièce et le selfie déjà déposés dans le compartiment privé.
 * La base vérifie que chaque fichier existe et se trouve dans le dossier du membre.
 */
export async function submitDocuments(input: {
  kind: DocumentKind;
  front: string;
  back: string | null;
  selfie: string;
}): Promise<ApiResult<void>> {
  if (!documentKinds.includes(input.kind)) return { ok: false, error: "invalid_document_kind" };
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { error } = await supabase.rpc("submit_id_documents", {
    p_kind: input.kind,
    p_front: input.front,
    p_back: input.kind === "passport" ? null : input.back,
    p_selfie: input.selfie,
  });
  return error ? failed(error) : { ok: true, data: undefined };
}
