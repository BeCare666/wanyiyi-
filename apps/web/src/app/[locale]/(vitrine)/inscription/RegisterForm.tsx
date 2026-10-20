"use client";

import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useState } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { Link, useRouter } from "@/i18n/navigation";
import { authErrorKey } from "@/lib/auth-errors";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { completeRegistration } from "./actions";
import { type Account, checkAccount, checkIdentity, type Identity, latestBirthDate } from "./registration";

type Step = "account" | "inbox" | "identity";

const knownErrors = new Set([
  "invalid_email",
  "weak_password",
  "password_mismatch",
  "email_exists",
  "tooManyRequests",
  "unavailable",
  "invalid_name",
  "invalid_sex",
  "invalid_birth_date",
  "too_young",
  "invalid_city",
  "consent_required",
  "forbidden",
]);

/**
 * Inscription (section 6.2-2, décision du 20 octobre 2026) : adresse e-mail et mot de passe,
 * lien de confirmation envoyé par l'API (hook de Supabase Auth, via Brevo), puis identité et
 * consentement. Le lien ouvre /confirmation, qui connecte le membre et le ramène ici, à l'identité.
 * La vérification (pièce, selfie, déclaration) suit dans l'espace membre.
 */
export function RegisterForm({ initialStep }: { initialStep: Step }) {
  const t = useTranslations("Register");
  const locale = useLocale();
  const router = useRouter();
  const [step, setStep] = useState<Step>(initialStep);
  const [account, setAccount] = useState<Account>({ email: "", password: "", passwordConfirm: "" });
  const [identity, setIdentity] = useState<Identity>({ firstName: "", lastName: "", sex: "", birthDate: "", city: "", consent: false });
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [pending, setPending] = useState(false);

  const supabase = createSupabaseBrowser();
  if (!supabase) {
    return (
      <p role="status" className="border-l border-accent pl-5 text-fg-muted">
        {t("errors.unavailable")}
      </p>
    );
  }

  const fail = (key: string) => {
    setPending(false);
    setError(knownErrors.has(key) ? key : "generic");
  };

  async function createAccount(e: FormEvent) {
    e.preventDefault();
    const invalid = checkAccount(account);
    if (invalid) return fail(invalid);
    setPending(true);
    setError(null);
    const email = account.email.trim();
    // Langue reprise sur le compte (déclencheur de la base) et dans l'e-mail de confirmation
    const { data, error: authError } = await supabase!.auth.signUp({ email, password: account.password, options: { data: { locale } } });
    if (authError) return fail(authErrorKey(authError));
    setPending(false);
    setAccount({ email, password: "", passwordConfirm: "" });
    // Confirmation désactivée dans Supabase : le compte est déjà connecté
    setStep(data.session ? "identity" : "inbox");
  }

  async function resend() {
    setPending(true);
    setError(null);
    const { error: authError } = await supabase!.auth.resend({ type: "signup", email: account.email });
    if (authError) return fail(authErrorKey(authError));
    setPending(false);
    setResent(true);
  }

  async function register(e: FormEvent) {
    e.preventDefault();
    const invalid = checkIdentity(identity, new Date());
    if (invalid) return fail(invalid);
    setPending(true);
    setError(null);
    const result = await completeRegistration(identity);
    if (!result.ok && result.error !== "already_registered") return fail(result.error);
    router.replace("/espace/verification");
    router.refresh();
  }

  const set = <K extends keyof Identity>(key: K, value: Identity[K]) => setIdentity((d) => ({ ...d, [key]: value }));
  const setField = (key: keyof Account) => (e: { target: { value: string } }) => setAccount((d) => ({ ...d, [key]: e.target.value }));
  const errorMessage = error && (
    <p role="alert" className="mt-6 border-l border-accent pl-5">
      {t(`errors.${error}`)}
    </p>
  );
  const link = (href: string) => (chunks: ReactNode) => (
    <Link href={href} target="_blank" className="text-link underline underline-offset-4">
      {chunks}
    </Link>
  );

  if (step === "account") {
    return (
      <form onSubmit={createAccount} noValidate>
        <h2 className="text-2xl">{t("accountTitle")}</h2>
        <label className="mt-8 block">
          <span className="eyebrow">{t("email")}</span>
          <input
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={account.email}
            onChange={setField("email")}
            aria-invalid={error === "invalid_email" || error === "email_exists" || undefined}
            className={fieldClass}
          />
          <span className="mt-2 block text-xs text-fg-muted">{t("emailHelp")}</span>
        </label>
        <label className="mt-8 block">
          <span className="eyebrow">{t("password")}</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            value={account.password}
            onChange={setField("password")}
            aria-invalid={error === "weak_password" || undefined}
            className={fieldClass}
          />
          <span className="mt-2 block text-xs text-fg-muted">{t("passwordHelp")}</span>
        </label>
        <label className="mt-8 block">
          <span className="eyebrow">{t("passwordConfirm")}</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            value={account.passwordConfirm}
            onChange={setField("passwordConfirm")}
            aria-invalid={error === "password_mismatch" || undefined}
            className={fieldClass}
          />
        </label>
        {errorMessage}
        <Button type="submit" disabled={pending} className="mt-10 w-full sm:w-auto">
          {t("create")}
        </Button>
        <p className="mt-8 text-sm text-fg-muted">
          {t.rich("already", { signin: link("/connexion") })}
        </p>
      </form>
    );
  }

  if (step === "inbox") {
    return (
      <div>
        <h2 className="text-2xl">{t("inboxTitle")}</h2>
        <p role="status" className="mt-4 text-fg-muted">
          {t("inboxText", { email: account.email })}
        </p>
        <p className="mt-4 text-sm text-fg-muted">{t.rich("inboxExisting", { signin: link("/connexion") })}</p>
        {resent && !error && (
          <p role="status" className="mt-6 border-l border-accent pl-5 text-sm">
            {t("resent")}
          </p>
        )}
        {errorMessage}
        <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-sm">
          <button type="button" disabled={pending} onClick={resend} className="text-link underline-offset-4 hover:underline">
            {t("resend")}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep("account");
              setResent(false);
              setError(null);
            }}
            className="text-link underline-offset-4 hover:underline"
          >
            {t("changeEmail")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={register} noValidate>
      <h2 className="text-2xl">{t("identityTitle")}</h2>
      <p className="mt-4 text-fg-muted">{t("identityIntro")}</p>

      <div className="mt-8 grid gap-8 sm:grid-cols-2">
        <label className="block">
          <span className="eyebrow">{t("firstName")}</span>
          <input type="text" autoComplete="given-name" required maxLength={60} value={identity.firstName} onChange={(e) => set("firstName", e.target.value)} className={fieldClass} />
        </label>
        <label className="block">
          <span className="eyebrow">{t("lastName")}</span>
          <input type="text" autoComplete="family-name" required maxLength={60} value={identity.lastName} onChange={(e) => set("lastName", e.target.value)} className={fieldClass} />
          <span className="mt-2 block text-xs text-fg-muted">{t("lastNameHelp")}</span>
        </label>
      </div>

      <fieldset className="mt-8">
        <legend className="eyebrow">{t("sex")}</legend>
        <div className="mt-4 flex flex-wrap gap-8">
          {(["female", "male"] as const).map((s) => (
            <label key={s} className="inline-flex min-h-11 items-center gap-3">
              <input type="radio" name="sexe" value={s} checked={identity.sex === s} onChange={() => set("sex", s)} />
              {t(`sexes.${s}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-8 grid gap-8 sm:grid-cols-2">
        <label className="block">
          <span className="eyebrow">{t("birthDate")}</span>
          <input
            type="date"
            autoComplete="bday"
            required
            min="1900-01-01"
            max={latestBirthDate(new Date())}
            value={identity.birthDate}
            onChange={(e) => set("birthDate", e.target.value)}
            aria-invalid={error === "too_young" || error === "invalid_birth_date" || undefined}
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className="eyebrow">{t("city")}</span>
          <input type="text" autoComplete="address-level2" maxLength={80} value={identity.city} onChange={(e) => set("city", e.target.value)} className={fieldClass} />
          <span className="mt-2 block text-xs text-fg-muted">{t("cityHelp")}</span>
        </label>
      </div>
      <p className="mt-4 text-sm text-fg-muted">{t("identityHelp")}</p>

      <label className="mt-10 flex items-start gap-3">
        <input type="checkbox" checked={identity.consent} onChange={(e) => set("consent", e.target.checked)} className="mt-1.5" />
        <span className="text-sm">{t.rich("consent", { rules: link("/reglement"), privacy: link("/confidentialite") })}</span>
      </label>

      {errorMessage}
      <Button type="submit" disabled={pending} className="mt-10 w-full sm:w-auto">
        {t("submit")}
      </Button>
    </form>
  );
}
