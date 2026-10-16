"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { useRouter } from "@/i18n/navigation";
import { normalizePhone } from "@/lib/phone";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

type ErrorKey = "invalidPhone" | "noAccount" | "invalidCode" | "tooManyRequests" | "unavailable" | "generic";

/** Erreur Supabase Auth vers la clé de message affichée. */
function toErrorKey(error: { code?: string; status?: number }, step: "phone" | "code"): ErrorKey {
  if (error.status === 429 || error.code?.startsWith("over_")) return "tooManyRequests";
  if (step === "phone" && ["otp_disabled", "signup_disabled", "user_not_found"].includes(error.code ?? "")) return "noAccount";
  if (step === "code" && ["otp_expired", "invalid_credentials", "bad_jwt"].includes(error.code ?? "")) return "invalidCode";
  if (step === "code" && error.status === 403) return "invalidCode";
  return "generic";
}

/**
 * Connexion par code OTP envoyé par SMS (Supabase Auth, SMS via Brevo).
 * Seuls les comptes existants peuvent se connecter ici : l'inscription a son propre parcours.
 */
export function SignInForm({ next }: { next: string }) {
  const t = useTranslations("SignIn");
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<ErrorKey | null>(null);
  const [pending, setPending] = useState(false);

  const supabase = createSupabaseBrowser();
  if (!supabase) {
    return (
      <p role="status" className="mt-12 border-l border-accent pl-5 text-fg-muted">
        {t("errors.unavailable")}
      </p>
    );
  }

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    const normalized = normalizePhone(phone);
    if (!normalized) return setError("invalidPhone");
    setPending(true);
    setError(null);
    const { error: authError } = await supabase!.auth.signInWithOtp({ phone: normalized, options: { shouldCreateUser: false } });
    setPending(false);
    if (authError) return setError(toErrorKey(authError, "phone"));
    setPhone(normalized);
    setStep("code");
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error: authError } = await supabase!.auth.verifyOtp({ phone, token: code.trim(), type: "sms" });
    if (authError) {
      setPending(false);
      return setError(toErrorKey(authError, "code"));
    }
    router.replace(next);
    router.refresh();
  }

  const errorMessage = error && (
    <div role="alert" className="mt-6 border-l border-accent pl-5">
      <p className="text-fg">{t(`errors.${error}`)}</p>
      {error === "noAccount" && (
        <ButtonLink href="/inscription" variant="secondary" size="sm" className="mt-4">
          {t("noAccountCta")}
        </ButtonLink>
      )}
    </div>
  );

  if (step === "phone") {
    return (
      <form onSubmit={sendCode} noValidate className="mt-12">
        <label htmlFor="telephone" className="eyebrow">
          {t("phone")}
        </label>
        <input
          id="telephone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          placeholder="+229"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          aria-describedby="telephone-aide"
          aria-invalid={error === "invalidPhone" || undefined}
          className={fieldClass}
        />
        <p id="telephone-aide" className="mt-3 text-sm text-fg-muted">
          {t("phoneHelp")}
        </p>
        {errorMessage}
        <Button type="submit" disabled={pending} className="mt-10 w-full sm:w-auto">
          {t("send")}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={verify} noValidate className="mt-12">
      <p className="text-fg-muted">{t("sentTo", { phone })}</p>
      <label htmlFor="code" className="eyebrow mt-8 block">
        {t("code")}
      </label>
      <input
        id="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        required
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        aria-invalid={error === "invalidCode" || undefined}
        className={`${fieldClass} tracking-[0.4em]`}
      />
      {errorMessage}
      <Button type="submit" disabled={pending || code.length === 0} className="mt-10 w-full sm:w-auto">
        {t("verify")}
      </Button>
      <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-sm">
        <button type="button" disabled={pending} onClick={() => sendCode()} className="text-link underline-offset-4 hover:underline">
          {t("resend")}
        </button>
        <button
          type="button"
          onClick={() => {
            setStep("phone");
            setCode("");
            setError(null);
          }}
          className="text-link underline-offset-4 hover:underline"
        >
          {t("changeNumber")}
        </button>
      </div>
    </form>
  );
}
