"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { submitSelfie } from "./actions";
import { SelfieCamera } from "./SelfieCamera";
import { BUCKET, knownVerificationErrors, MAX_FILE_BYTES, selfieError, storagePath } from "./verification";

/**
 * Selfie, visage seul, pris en direct avec la caméra (plus de pièce d'identité, 22 octobre 2026).
 * La photo part directement du navigateur vers le compartiment privé, avec le jeton du membre :
 * la politique de stockage n'autorise que le dépôt dans son propre dossier.
 * La base enregistre ensuite le dossier (app.submit_selfie).
 */
export function SelfieForm({ userId }: { userId: string }) {
  const t = useTranslations("Member.verification.documents");
  const te = useTranslations("Member.verification.errors");
  const router = useRouter();
  const [selfie, setSelfie] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function capture(file: File | undefined) {
    setError(null);
    if (!file) return setSelfie(null);
    const problem = selfieError(file);
    if (problem) return setError(`form.${problem}`);
    setSelfie(file);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!selfie) return setError("form.missing");
    setError(null);
    startTransition(async () => {
      const supabase = createSupabaseBrowser();
      if (!supabase) return setError("unavailable");
      const path = storagePath(userId, selfie.type, crypto.randomUUID());
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, selfie, { contentType: selfie.type, upsert: false });
      if (uploadError) return setError("upload_failed");
      const result = await submitSelfie(path);
      if (!result.ok) return setError(knownVerificationErrors.has(result.error) ? result.error : "generic");
      setSelfie(null);
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
      <span className="text-sm font-medium">{t("slots.selfie")}</span>
      <span className="mt-1 block text-xs text-fg-muted">{t("selfieHelp")}</span>
      <SelfieCamera onCapture={capture} />

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
