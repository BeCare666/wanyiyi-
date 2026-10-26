"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { fieldClass } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { saveText } from "./actions";
import { type TextField, type TextResult, textFields, textMaxLength } from "./profile";

/** Texte du profil et son état de relecture (question 22 : refusé avec un motif écrit). */
export type ProfileText = { body: string; status: "pending" | "approved" | "rejected" | null; note: string | null };

/**
 * Trois textes libres d'environ 300 caractères (section 8.1). Enregistrés en quittant la zone
 * de texte ; l'API refuse numéros, liens, adresses e-mail et pseudos, puis le texte part en relecture.
 */
export function TextsStep({ texts, onWrittenChange }: { texts: Record<string, ProfileText>; onWrittenChange: (count: number) => void }) {
  const t = useTranslations("Member.profile.texts");
  const [values, setValues] = useState<Record<TextField, ProfileText>>(
    () => Object.fromEntries(textFields.map((f) => [f, texts[f] ?? { body: "", status: null, note: null }])) as Record<TextField, ProfileText>,
  );
  const [saved, setSaved] = useState<Record<string, string>>(() => Object.fromEntries(textFields.map((f) => [f, texts[f]?.body ?? ""])));
  const [results, setResults] = useState<Partial<Record<TextField, TextResult>>>({});

  async function save(field: TextField) {
    const body = values[field].body;
    if (body.trim() === saved[field]!.trim()) return;
    const result = await saveText(field, body);
    setResults((r) => ({ ...r, [field]: result }));
    if (result === "saved" || result === "removed") {
      const next = { ...saved, [field]: result === "removed" ? "" : body };
      setSaved(next);
      setValues((v) => ({ ...v, [field]: { body: result === "removed" ? "" : body, status: result === "saved" ? "pending" : null, note: null } }));
      onWrittenChange(Object.values(next).filter((b) => b.trim() !== "").length);
    }
  }

  return (
    <div className="mt-6 grid gap-10">
      <p className="max-w-measure text-sm text-fg-muted">{t("help")}</p>
      {textFields.map((field) => {
        const value = values[field];
        const result = results[field];
        const refused = result === "text_rejected" || result === "too_long" || result === "failed";
        return (
          <label key={field} className="block">
            <span className="font-medium">{t(`fields.${field}`)}</span>
            <textarea
              value={value.body}
              maxLength={textMaxLength}
              rows={4}
              onChange={(e) => {
                const body = e.target.value;
                setValues((v) => ({ ...v, [field]: { ...v[field], body } }));
                setResults((r) => ({ ...r, [field]: undefined }));
              }}
              onBlur={() => void save(field)}
              aria-invalid={refused || undefined}
              className={cn(fieldClass, "mt-2 resize-y text-base")}
            />
            <span className="mt-2 flex flex-wrap justify-between gap-4 text-sm text-fg-muted">
              <span>
                {result && refused ? (
                  <span role="alert" className="text-fg">
                    {t(`results.${result}`)}
                  </span>
                ) : value.status === "rejected" ? (
                  <span className="text-fg">{t("rejected", { note: value.note ?? "" })}</span>
                ) : value.status ? (
                  t(`status.${value.status}`)
                ) : null}
              </span>
              <span aria-hidden="true">
                {value.body.length}/{textMaxLength}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
