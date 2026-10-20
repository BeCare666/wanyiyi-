"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { Link } from "@/i18n/navigation";
import { authErrorKey } from "@/lib/auth-errors";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { isEmail } from "../espace/parametres/settings";

/**
 * Demande du lien de réinitialisation. La réponse est la même qu'un compte existe ou non :
 * la page ne révèle pas quelles adresses sont inscrites.
 */
export function ForgotForm() {
  const t = useTranslations("Password");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sent" | "invalid_email" | "tooManyRequests" | "unavailable" | "generic">("idle");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!isEmail(value)) return setState("invalid_email");
    const supabase = createSupabaseBrowser();
    if (!supabase) return setState("unavailable");
    setPending(true);
    const { error } = await supabase.auth.resetPasswordForEmail(value);
    setPending(false);
    if (!error) return setState("sent");
    const key = authErrorKey(error);
    setState(key === "tooManyRequests" || key === "invalid_email" ? key : "generic");
  }

  return (
    <form onSubmit={submit} noValidate className="mt-12">
      <label className="block">
        <span className="eyebrow">{t("email")}</span>
        <input
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setState("idle");
          }}
          aria-invalid={state === "invalid_email" || undefined}
          className={fieldClass}
        />
      </label>
      {state !== "idle" && (
        <p role={state === "sent" ? "status" : "alert"} className="mt-6 border-l border-accent pl-5">
          {state === "sent" ? t("sent") : t(`errors.${state}`)}
        </p>
      )}
      <Button type="submit" disabled={pending} className="mt-10 w-full sm:w-auto">
        {t("send")}
      </Button>
      <p className="mt-8 text-sm">
        <Link href="/connexion" className="text-link underline-offset-4 hover:underline">
          {t("back")}
        </Link>
      </p>
    </form>
  );
}
