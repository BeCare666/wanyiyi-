"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { submitDocuments } from "./actions";
import {
  BUCKET,
  type DocumentKind,
  documentKinds,
  type FileSlot,
  fileError,
  knownVerificationErrors,
  MAX_FILE_BYTES,
  requiredSlots,
  storagePath,
} from "./verification";

/**
 * Pièce d'identité (une seule) et selfie, visage seul.
 * Les fichiers partent directement du navigateur vers le compartiment privé, avec le jeton
 * du membre : la politique de stockage n'autorise que le dépôt dans son propre dossier.
 * La base enregistre ensuite le dossier (app.submit_id_documents).
 */
export function DocumentsForm({ userId }: { userId: string }) {
  const t = useTranslations("Member.verification.documents");
  const te = useTranslations("Member.verification.errors");
  const router = useRouter();
  const [kind, setKind] = useState<DocumentKind | null>(null);
  const [files, setFiles] = useState<Partial<Record<FileSlot, File>>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(slot: FileSlot, file: File | undefined) {
    setError(null);
    if (!file) {
      return setFiles((f) => {
        const next = { ...f };
        delete next[slot];
        return next;
      });
    }
    const problem = fileError(slot, file);
    if (problem) return setError(`form.${problem}`);
    setFiles((f) => ({ ...f, [slot]: file }));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!kind) return setError("form.kind");
    const slots = requiredSlots(kind);
    if (slots.some((slot) => !files[slot])) return setError("form.missing");
    setError(null);
    startTransition(async () => {
      const supabase = createSupabaseBrowser();
      if (!supabase) return setError("unavailable");
      const paths: Partial<Record<FileSlot, string>> = {};
      for (const slot of slots) {
        const file = files[slot]!;
        const path = storagePath(userId, file.type, crypto.randomUUID());
        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
        if (uploadError) return setError("upload_failed");
        paths[slot] = path;
      }
      const result = await submitDocuments({ kind, front: paths.front!, back: paths.back ?? null, selfie: paths.selfie! });
      if (!result.ok) return setError(knownVerificationErrors.has(result.error) ? result.error : "generic");
      setFiles({});
      router.refresh();
    });
  }

  const errorText = error?.startsWith("form.")
    ? t(`errors.${error.slice(5)}`, { size: Math.round(MAX_FILE_BYTES / (1024 * 1024)) })
    : error
      ? te(error)
      : null;

  return (
    <form onSubmit={submit} noValidate>
      <fieldset>
        <legend className="text-sm font-medium">{t("kindLabel")}</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {documentKinds.map((value) => (
            <label
              key={value}
              className={cn(
                "flex min-h-12 cursor-pointer items-center gap-3 rounded-sm border px-4",
                kind === value ? "border-fg bg-bg-soft" : "border-line",
              )}
            >
              <input
                type="radio"
                name="kind"
                checked={kind === value}
                onChange={() => {
                  setKind(value);
                  setError(null);
                }}
                className="size-4 accent-[var(--accent)]"
              />
              <span>{t(`kinds.${value}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {kind && (
        <div className="mt-8 grid gap-6">
          {requiredSlots(kind).map((slot) => {
            const label = slot === "front" && kind === "passport" ? t("slots.photo_page") : t(`slots.${slot}`);
            return (
              <label key={`${kind}-${slot}`} className="block">
                <span className="text-sm font-medium">{label}</span>
                <span className="mt-1 block text-xs text-fg-muted">{t(slot === "selfie" ? "selfieHelp" : "fileHelp")}</span>
                <input
                  type="file"
                  accept={slot === "selfie" ? "image/jpeg,image/png,image/webp" : "image/jpeg,image/png,image/webp,application/pdf"}
                  {...(slot === "selfie" ? { capture: "user" as const } : {})}
                  onChange={(e) => choose(slot, e.target.files?.[0])}
                  className="mt-3 block w-full text-sm file:mr-4 file:min-h-10 file:rounded-sm file:border file:border-fg file:bg-transparent file:px-4 file:text-fg"
                />
              </label>
            );
          })}
        </div>
      )}

      {errorText && (
        <p role="alert" className="mt-6 border-l border-accent pl-5">
          {errorText}
        </p>
      )}
      <Button type="submit" disabled={pending} className="mt-8">
        {pending ? t("sending") : t("submit")}
      </Button>
    </form>
  );
}
