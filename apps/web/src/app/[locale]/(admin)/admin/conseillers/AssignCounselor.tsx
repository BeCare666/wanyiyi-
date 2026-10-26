"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { assignCounselor } from "./actions";

const knownErrors = new Set(["counselor_unavailable", "counselor_full", "couple_blocked", "not_pending", "not_paid", "not_found", "forbidden", "unavailable"]);

/** Choix du conseiller pour une demande acceptée par les deux membres du couple. */
export function AssignCounselor({ accessId, counselors }: { accessId: string; counselors: { id: string; name: string }[] }) {
  const t = useTranslations("Admin.counselors.requests");
  const router = useRouter();
  const [counselor, setCounselor] = useState(counselors[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!counselor) return;
    setError(null);
    startTransition(async () => {
      const result = await assignCounselor(accessId, counselor);
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      router.refresh();
    });
  };

  if (counselors.length === 0) return <p className="mt-3 text-sm text-fg-muted">{t("noneAvailable")}</p>;
  return (
    <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="text-sm">{t("choose")}</span>
        <select value={counselor} onChange={(e) => setCounselor(e.target.value)} className={cn(fieldClass, "mt-1 text-base")}>
          {counselors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" disabled={pending}>
        {t("assign")}
      </Button>
      {error && (
        <p role="alert" className="w-full border-l border-accent pl-4 text-sm">
          {t(`errors.${error}`)}
        </p>
      )}
    </form>
  );
}
