"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { useRouter } from "@/i18n/navigation";
import { authErrorKey } from "@/lib/auth-errors";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { checkPassword } from "../../(vitrine)/inscription/registration";

type ErrorKey = "weak_password" | "password_mismatch" | "same_password" | "tooManyRequests" | "unavailable" | "generic";

/** Nouveau mot de passe du membre connecté par le lien de réinitialisation, puis son espace. */
export function NewPasswordForm() {
  const t = useTranslations("Password");
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<ErrorKey | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const invalid = checkPassword(password, confirm);
    if (invalid) return setError(invalid);
    const supabase = createSupabaseBrowser();
    if (!supabase) return setError("unavailable");
    setPending(true);
    setError(null);
    const { error: authError } = await supabase.auth.updateUser({ password });
    if (authError) {
      setPending(false);
      const key = authErrorKey(authError);
      return setError(key === "weak_password" || key === "same_password" || key === "tooManyRequests" ? key : "generic");
    }
    router.replace("/espace");
    router.refresh();
  }

  return (
    <form onSubmit={submit} noValidate className="mt-12">
      <label className="block">
        <span className="eyebrow">{t("password")}</span>
        <PasswordInput
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error === "weak_password" || error === "same_password" || undefined}
        />
        <span className="mt-2 block text-xs text-fg-muted">{t("passwordHelp")}</span>
      </label>
      <label className="mt-8 block">
        <span className="eyebrow">{t("passwordConfirm")}</span>
        <PasswordInput
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-invalid={error === "password_mismatch" || undefined}
        />
      </label>
      {error && (
        <p role="alert" className="mt-6 border-l border-accent pl-5">
          {t(`errors.${error}`)}
        </p>
      )}
      <Button type="submit" disabled={pending} className="mt-10 w-full sm:w-auto">
        {t("save")}
      </Button>
    </form>
  );
}
