"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Link, useRouter } from "@/i18n/navigation";
import { authErrorKey } from "@/lib/auth-errors";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

type ErrorKey = "invalidCredentials" | "notConfirmed" | "invalidLink" | "tooManyRequests" | "unavailable" | "generic";

/** Seules ces erreurs ont un message sur cette page ; les autres deviennent « generic ». */
function toErrorKey(error: { code?: string; status?: number }): ErrorKey {
  const key = authErrorKey(error);
  return key === "invalidCredentials" || key === "notConfirmed" || key === "tooManyRequests" ? key : "generic";
}

/**
 * Connexion par adresse e-mail et mot de passe (Supabase Auth, décision du 20 octobre 2026).
 * Adresse pas encore confirmée : le lien peut être renvoyé. Compte sans profil (inscription
 * interrompue) : reprise de l'inscription à l'identité.
 */
export function SignInForm({ next, invalidLink }: { next: string; invalidLink: boolean }) {
  const t = useTranslations("SignIn");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<ErrorKey | null>(invalidLink ? "invalidLink" : null);
  const [resent, setResent] = useState(false);
  const [pending, setPending] = useState(false);

  const supabase = createSupabaseBrowser();
  if (!supabase) {
    return (
      <p role="status" className="mt-12 border-l border-accent pl-5 text-fg-muted">
        {t("errors.unavailable")}
      </p>
    );
  }

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setResent(false);
    const { data, error: authError } = await supabase!.auth.signInWithPassword({ email: email.trim(), password });
    if (authError || !data.user) {
      setPending(false);
      return setError(authError ? toErrorKey(authError) : "generic");
    }
    const { data: profile } = await supabase!.from("member_profiles").select("user_id").eq("user_id", data.user.id).maybeSingle();
    router.replace(profile ? next : "/inscription");
    router.refresh();
  }

  async function resendConfirmation() {
    setPending(true);
    const { error: authError } = await supabase!.auth.resend({ type: "signup", email: email.trim() });
    setPending(false);
    if (authError) return setError(toErrorKey(authError));
    setError(null);
    setResent(true);
  }

  return (
    <form onSubmit={signIn} noValidate className="mt-12">
      <label className="block">
        <span className="eyebrow">{t("email")}</span>
        <input
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error === "invalidCredentials" || undefined}
          className={fieldClass}
        />
      </label>
      <label className="mt-8 block">
        <span className="eyebrow">{t("password")}</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error === "invalidCredentials" || undefined}
          className={fieldClass}
        />
      </label>
      <p className="mt-3 text-sm">
        <Link href="/mot-de-passe-oublie" className="text-link underline-offset-4 hover:underline">
          {t("forgot")}
        </Link>
      </p>

      {error && (
        <div role="alert" className="mt-6 border-l border-accent pl-5">
          <p className="text-fg">{t(`errors.${error}`)}</p>
          {error === "notConfirmed" && (
            <button type="button" disabled={pending} onClick={resendConfirmation} className="mt-3 text-sm text-link underline-offset-4 hover:underline">
              {t("resendConfirmation")}
            </button>
          )}
        </div>
      )}
      {resent && (
        <p role="status" className="mt-6 border-l border-accent pl-5 text-sm">
          {t("resent")}
        </p>
      )}

      <Button type="submit" disabled={pending} className="mt-10 w-full sm:w-auto">
        {t("submit")}
      </Button>

      <div className="mt-12 border-t border-line pt-8">
        <p className="text-sm text-fg-muted">{t("noAccount")}</p>
        <ButtonLink href="/inscription" variant="secondary" size="sm" className="mt-4">
          {t("noAccountCta")}
        </ButtonLink>
      </div>
    </form>
  );
}
