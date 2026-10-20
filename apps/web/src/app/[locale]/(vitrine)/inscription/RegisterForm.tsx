"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useState } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { Link, useRouter } from "@/i18n/navigation";
import { normalizePhone } from "@/lib/phone";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { completeRegistration } from "./actions";
import { checkIdentity, type Identity, latestBirthDate } from "./registration";

type Step = "phone" | "code" | "identity";

const knownErrors = new Set([
  "invalidPhone",
  "invalidCode",
  "tooManyRequests",
  "unavailable",
  "invalid_name",
  "invalid_sex",
  "invalid_birth_date",
  "too_young",
  "invalid_city",
  "invalid_email",
  "consent_required",
  "forbidden",
]);

/** Erreur Supabase Auth vers la clé de message affichée (mêmes règles que la connexion). */
function authErrorKey(error: { code?: string; status?: number }, step: "phone" | "code"): string {
  if (error.status === 429 || error.code?.startsWith("over_")) return "tooManyRequests";
  if (step === "code" && (["otp_expired", "invalid_credentials", "bad_jwt"].includes(error.code ?? "") || error.status === 403)) return "invalidCode";
  return "generic";
}

/**
 * Inscription (section 6.2-2) : numéro de téléphone, code reçu par SMS (le compte naît ici),
 * puis identité et consentement. La vérification (pièce, selfie, déclaration) suit dans l'espace membre.
 * Un compte déjà inscrit est conduit à son espace ; un compte sans profil reprend à l'identité.
 */
export function RegisterForm({ initialStep }: { initialStep: Step }) {
  const t = useTranslations("Register");
  const router = useRouter();
  const [step, setStep] = useState<Step>(initialStep);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [identity, setIdentity] = useState<Identity>({ firstName: "", lastName: "", sex: "", birthDate: "", city: "", email: "", consent: false });
  const [error, setError] = useState<string | null>(null);
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

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    const normalized = normalizePhone(phone);
    if (!normalized) return fail("invalidPhone");
    setPending(true);
    setError(null);
    // Le compte est créé à la vérification du code ; un numéro déjà inscrit se connecte simplement
    const { error: authError } = await supabase!.auth.signInWithOtp({ phone: normalized, options: { shouldCreateUser: true } });
    if (authError) return fail(authErrorKey(authError, "phone"));
    setPending(false);
    setPhone(normalized);
    setStep("code");
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { data, error: authError } = await supabase!.auth.verifyOtp({ phone, token: code.trim(), type: "sms" });
    if (authError || !data.user) return fail(authError ? authErrorKey(authError, "code") : "generic");
    const { data: profile } = await supabase!.from("member_profiles").select("user_id").eq("user_id", data.user.id).maybeSingle();
    if (profile) {
      // Déjà membre : direction l'espace
      router.replace("/espace");
      router.refresh();
      return;
    }
    setPending(false);
    setStep("identity");
  }

  async function register(e: FormEvent) {
    e.preventDefault();
    const invalid = checkIdentity(identity, new Date());
    if (invalid) return fail(invalid);
    setPending(true);
    setError(null);
    const result = await completeRegistration(identity);
    if (!result.ok && result.error !== "already_registered") return fail(result.error);
    // Adresse facultative : Supabase Auth envoie un lien de confirmation (hook de l'API, via Brevo)
    let emailFailed = false;
    if (identity.email.trim()) {
      const { error: emailError } = await supabase!.auth.updateUser({ email: identity.email.trim() });
      emailFailed = Boolean(emailError);
    }
    // Adresse refusée : les Paramètres l'expliquent et permettent de réessayer ; sinon, la vérification
    router.replace(emailFailed ? { pathname: "/espace/parametres", query: { email: "echec" } } : "/espace/verification");
    router.refresh();
  }

  const set = <K extends keyof Identity>(key: K, value: Identity[K]) => setIdentity((d) => ({ ...d, [key]: value }));
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

  if (step === "phone") {
    return (
      <form onSubmit={sendCode} noValidate>
        <h2 className="text-2xl">{t("phoneTitle")}</h2>
        <label htmlFor="telephone" className="eyebrow mt-8 block">
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
        <p className="mt-8 text-sm text-fg-muted">
          {t.rich("already", { signin: link("/connexion") })}
        </p>
      </form>
    );
  }

  if (step === "code") {
    return (
      <form onSubmit={verify} noValidate>
        <h2 className="text-2xl">{t("codeTitle")}</h2>
        <p className="mt-4 text-fg-muted">{t("sentTo", { phone })}</p>
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

      <label className="mt-8 block">
        <span className="eyebrow">{t("email")}</span>
        <input type="email" autoComplete="email" maxLength={254} value={identity.email} onChange={(e) => set("email", e.target.value)} className={fieldClass} />
        <span className="mt-2 block text-xs text-fg-muted">{t("emailHelp")}</span>
      </label>

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
