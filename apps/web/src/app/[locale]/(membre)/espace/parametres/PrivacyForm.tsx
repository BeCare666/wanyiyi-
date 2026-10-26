"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { savePrivacy } from "./actions";
import { type Privacy, type PrivacyField, privacyFields } from "./settings";

/**
 * Confidentialité (question 15, 24 octobre 2026) : photo cachée jusqu'à un match réciproque,
 * numéro partagé après un match ; photo gardée floutée (10.2, phase 3). Enregistré dès que le
 * réglage change.
 */
export function PrivacyForm({ initial }: { initial: Privacy }) {
  const t = useTranslations("Member.settings");
  const [privacy, setPrivacy] = useState(initial);
  const [status, setStatus] = useState<boolean | null>(null);
  const [, startTransition] = useTransition();

  function toggle(field: PrivacyField, enabled: boolean) {
    setStatus(null);
    setPrivacy((p) => ({ ...p, [field]: enabled }));
    startTransition(async () => {
      const ok = await savePrivacy(field, enabled);
      if (!ok) setPrivacy((p) => ({ ...p, [field]: !enabled }));
      setStatus(ok);
    });
  }

  return (
    <section aria-labelledby="parametres-confidentialite" className="grid gap-4 border-b border-line py-8 md:grid-cols-12 md:gap-8">
      <h2 id="parametres-confidentialite" className="eyebrow md:col-span-4">
        {t("privacy.title")}
      </h2>
      <div className="md:col-span-8">
        <ul>
          {privacyFields.map((field) => (
            <li key={field} className="border-b border-line py-3 last:border-b-0">
              <label className="flex min-h-12 cursor-pointer items-center justify-between gap-6">
                <span>
                  {t(`privacy.${field}`)}
                  <span className="mt-1 block text-sm text-fg-muted">{t(`privacy.${field}Help`)}</span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={privacy[field]}
                  onChange={(e) => toggle(field, e.target.checked)}
                  className="size-5 shrink-0 accent-[var(--accent)]"
                />
              </label>
            </li>
          ))}
        </ul>
        {status !== null && (
          <p role={status ? "status" : "alert"} className={cn("mt-4 border-l pl-4 text-sm", status ? "border-fg" : "border-accent")}>
            {t(status ? "saved" : "error")}
          </p>
        )}
      </div>
    </section>
  );
}
