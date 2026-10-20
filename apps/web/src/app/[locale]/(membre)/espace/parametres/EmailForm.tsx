"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { isEmail } from "./settings";

/**
 * Adresse e-mail du compte (identifiant de connexion depuis le 20 octobre 2026). Un changement est
 * confirmé par un lien que Supabase Auth envoie (hook de l'API, via Brevo). Tant que le lien n'est pas
 * ouvert, l'ancienne adresse reste en place et la nouvelle est affichée « en attente ».
 */
export function EmailForm({ current, pending: pendingEmail, confirmed }: { current: string | null; pending: string | null; confirmed: boolean }) {
  const t = useTranslations("Member.settings.email");
  const [email, setEmail] = useState(pendingEmail ?? "");
  const [state, setState] = useState<"idle" | "sent" | "invalid" | "failed" | "confirmed">(confirmed ? "confirmed" : "idle");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!isEmail(value)) return setState("invalid");
    const supabase = createSupabaseBrowser();
    if (!supabase) return setState("failed");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ email: value });
    setBusy(false);
    setState(error ? "failed" : "sent");
  }

  return (
    <section id="email" aria-labelledby="email-titre" className="mt-14 border-t border-line pt-10">
      <h2 id="email-titre" className="text-2xl">
        {t("title")}
      </h2>
      <p className="mt-3 max-w-measure text-fg-muted">{t("help")}</p>
      {current && <p className="mt-4 text-sm">{t("current", { email: current })}</p>}
      {pendingEmail && <p className="mt-2 text-sm text-fg-muted">{t("pending", { email: pendingEmail })}</p>}
      <form onSubmit={submit} noValidate className="mt-6 max-w-xl">
        <label className="block">
          <span className="eyebrow">{t("label")}</span>
          <input
            type="email"
            autoComplete="email"
            maxLength={254}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setState("idle");
            }}
            aria-invalid={state === "invalid" || undefined}
            className={fieldClass}
          />
        </label>
        {state !== "idle" && (
          <p role={state === "sent" || state === "confirmed" ? "status" : "alert"} className="mt-4 border-l border-accent pl-5 text-sm">
            {t(`states.${state}`)}
          </p>
        )}
        <Button type="submit" variant="secondary" disabled={busy} className="mt-6">
          {t("save")}
        </Button>
      </form>
    </section>
  );
}
