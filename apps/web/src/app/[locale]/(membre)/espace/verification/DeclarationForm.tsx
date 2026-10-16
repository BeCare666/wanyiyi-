"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { signDeclaration } from "./actions";
import { knownVerificationErrors, maritalStatuses, OTHER_DETAILS_MAX, parseDeclaration } from "./verification";

/**
 * Déclaration sur l'honneur : situation matrimoniale, enfants, texte à certifier.
 * « Autre » se précise dans un champ libre, examiné par l'équipe à l'entretien.
 */
export function DeclarationForm() {
  const t = useTranslations("Member.verification.declaration");
  const te = useTranslations("Member.verification.errors");
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [hasChildren, setHasChildren] = useState<boolean | null>(null);
  const [otherDetails, setOtherDetails] = useState("");
  const [certified, setCertified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: FormEvent) {
    e.preventDefault();
    const input = { status, hasChildren, otherDetails, certified };
    const parsed = parseDeclaration(input);
    if (!parsed.ok) return setError(`form.${parsed.error}`);
    setError(null);
    startTransition(async () => {
      const result = await signDeclaration(input);
      if (!result.ok) return setError(knownVerificationErrors.has(result.error) ? result.error : "generic");
      router.refresh();
    });
  }

  const errorText = error?.startsWith("form.") ? t(`errors.${error.slice(5)}`) : error ? te(error) : null;

  return (
    <form onSubmit={submit} noValidate>
      <fieldset>
        <legend className="text-sm font-medium">{t("statusLabel")}</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {maritalStatuses.map((value) => (
            <label
              key={value}
              className={cn(
                "flex min-h-12 cursor-pointer items-center gap-3 rounded-sm border px-4",
                status === value ? "border-fg bg-bg-soft" : "border-line",
              )}
            >
              <input
                type="radio"
                name="status"
                value={value}
                checked={status === value}
                onChange={() => setStatus(value)}
                className="size-4 accent-[var(--accent)]"
              />
              <span>{t(`statuses.${value}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {status === "other" && (
        <label className="mt-6 block">
          <span className="text-sm font-medium">{t("otherLabel")}</span>
          <textarea
            value={otherDetails}
            onChange={(e) => setOtherDetails(e.target.value)}
            maxLength={OTHER_DETAILS_MAX}
            rows={3}
            className={cn(fieldClass, "resize-y text-base")}
          />
          <span className="mt-2 block text-xs text-fg-muted">
            {t("otherHelp", { count: OTHER_DETAILS_MAX - otherDetails.length })}
          </span>
        </label>
      )}

      <fieldset className="mt-8">
        <legend className="text-sm font-medium">{t("childrenLabel")}</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {([true, false] as const).map((value) => (
            <label
              key={String(value)}
              className={cn(
                "flex min-h-12 cursor-pointer items-center gap-3 rounded-sm border px-4",
                hasChildren === value ? "border-fg bg-bg-soft" : "border-line",
              )}
            >
              <input
                type="radio"
                name="children"
                checked={hasChildren === value}
                onChange={() => setHasChildren(value)}
                className="size-4 accent-[var(--accent)]"
              />
              <span>{t(value ? "withChildren" : "withoutChildren")}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-8 border-l border-accent pl-5">
        <p className="eyebrow">{t("textTitle")}</p>
        <p className="mt-3 max-w-measure text-fg-muted">{t("text")}</p>
      </div>

      <label className="mt-6 flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={certified}
          onChange={(e) => setCertified(e.target.checked)}
          className="mt-1 size-4 accent-[var(--accent)]"
        />
        <span>{t("certify")}</span>
      </label>

      {errorText && (
        <p role="alert" className="mt-6 border-l border-accent pl-5">
          {errorText}
        </p>
      )}
      <Button type="submit" disabled={pending} className="mt-8">
        {t("submit")}
      </Button>
    </form>
  );
}
