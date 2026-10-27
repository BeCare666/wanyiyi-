"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { addNote } from "../../actions";
import { NOTE_MAX } from "../../counselor";

const knownErrors = new Set(["invalid_body", "not_counselor", "unavailable"]);

/** Nouvelle note privée (jamais visible par les membres). */
export function NoteForm({ coupleId }: { coupleId: string }) {
  const t = useTranslations("Counselor.notes");
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await addNote(coupleId, body);
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      setBody("");
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="mt-4">
      <label className="block">
        <span className="sr-only">{t("label")}</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={NOTE_MAX}
          placeholder={t("placeholder")}
          className={cn(fieldClass, "resize-y text-base")}
        />
      </label>
      <div className="mt-3">
        <Button type="submit" disabled={pending || body.trim() === ""}>
          {t("add")}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-4 border-l border-accent pl-4 text-sm">
          {t(`errors.${error}`)}
        </p>
      )}
    </form>
  );
}
