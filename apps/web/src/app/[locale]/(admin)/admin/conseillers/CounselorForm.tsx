"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { createCounselor, updateCounselor } from "./actions";
import { checkCounselor, counselorLanguages, type CounselorRow } from "./counselors";

const knownErrors = new Set(["name_required", "languages_required", "invalid_capacity", "not_found", "not_a_member", "self_action", "forbidden", "unavailable"]);
const field = cn(fieldClass, "mt-1 text-base");

/**
 * Création (à partir d'un numéro de membre) ou modification d'un conseiller (11.2-8). Sans
 * « existing », le formulaire crée ; avec, il modifie et propose la disponibilité.
 */
export function CounselorForm({ existing }: { existing?: CounselorRow }) {
  const t = useTranslations("Admin.counselors.form");
  const router = useRouter();
  const [memberNumber, setMemberNumber] = useState("");
  const [name, setName] = useState(existing?.display_name ?? "");
  const [bio, setBio] = useState(existing?.bio ?? "");
  const [languages, setLanguages] = useState<string[]>(existing?.languages ?? ["fr"]);
  const [maxCouples, setMaxCouples] = useState(existing?.max_couples ?? 20);
  const [available, setAvailable] = useState(existing?.is_available ?? true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const id = existing?.user_id ?? "nouveau";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setDone(false);
    const input = { name, bio, languages, maxCouples };
    const invalid = checkCounselor(input);
    if (invalid) return setError(invalid);
    setError(null);
    startTransition(async () => {
      const result = existing ? await updateCounselor(existing.user_id, input, available) : await createCounselor(memberNumber, input);
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      setDone(true);
      if (!existing) setMemberNumber("");
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-5 md:grid-cols-2">
      {!existing && (
        <label className="block md:col-span-2">
          <span className="text-sm font-medium">{t("memberNumber")}</span>
          <span className="mt-1 block text-xs text-fg-muted">{t("memberNumberHelp")}</span>
          <input value={memberNumber} onChange={(e) => setMemberNumber(e.target.value)} maxLength={40} className={field} />
        </label>
      )}
      <label className="block">
        <span className="text-sm font-medium">{t("name")}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={field} />
      </label>
      <label className="block">
        <span className="text-sm font-medium">{t("maxCouples")}</span>
        <input
          type="number"
          min={1}
          max={100}
          value={maxCouples}
          onChange={(e) => setMaxCouples(Math.trunc(e.target.valueAsNumber || 0))}
          className={cn(field, "tabular-nums")}
        />
      </label>
      <label className="block md:col-span-2">
        <span className="text-sm font-medium">{t("bio")}</span>
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={2} maxLength={1000} className={cn(field, "resize-y")} />
      </label>
      <fieldset className="md:col-span-2">
        <legend className="text-sm font-medium">{t("languages")}</legend>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
          {counselorLanguages.map((l) => (
            <label key={l} className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={languages.includes(l)}
                onChange={(e) => setLanguages((list) => (e.target.checked ? [...list, l] : list.filter((x) => x !== l)))}
              />
              {t(`language.${l}`)}
            </label>
          ))}
        </div>
      </fieldset>
      {existing && (
        <label className="inline-flex items-center gap-2 text-sm md:col-span-2">
          <input type="checkbox" checked={available} onChange={(e) => setAvailable(e.target.checked)} />
          {t("available")}
        </label>
      )}
      <div className="md:col-span-2">
        <Button type="submit" disabled={pending} aria-describedby={`etat-${id}`}>
          {existing ? t("save") : t("create")}
        </Button>
        <span id={`etat-${id}`}>
          {error && (
            <p role="alert" className="mt-4 border-l border-accent pl-5 text-sm">
              {t(`errors.${error}`)}
            </p>
          )}
          {done && (
            <p role="status" className="mt-4 text-sm text-fg-muted">
              {t(existing ? "saved" : "created")}
            </p>
          )}
        </span>
      </div>
    </form>
  );
}
