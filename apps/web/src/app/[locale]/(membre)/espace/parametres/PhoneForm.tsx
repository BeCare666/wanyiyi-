"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import { normalizePhone } from "@/lib/phone";
import { type PhoneResult, savePhone } from "./actions";

/**
 * Téléphone facultatif (décision du 20 octobre 2026), jamais montré aux autres membres sauf partage
 * après un match. Il n'est pas vérifié par un code (pas de frais d'envoi) ; la base contrôle format et unicité.
 */
export function PhoneForm({ current }: { current: string | null }) {
  const t = useTranslations("Member.settings.phone");
  const [phone, setPhone] = useState(current ?? "");
  const [saved, setSaved] = useState(current);
  const [state, setState] = useState<PhoneResult | "idle">("idle");
  const [busy, setBusy] = useState(false);

  async function send(value: string) {
    setBusy(true);
    const result = await savePhone(value);
    setBusy(false);
    setState(result);
    if (result === "saved" || result === "removed") {
      setSaved(value || null);
      setPhone(value);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizePhone(phone);
    if (!normalized) return setState("invalid_phone");
    void send(normalized);
  }

  return (
    <section id="telephone" aria-labelledby="telephone-titre" className="mt-14 border-t border-line pt-10">
      <h2 id="telephone-titre" className="text-2xl">
        {t("title")}
      </h2>
      <p className="mt-3 max-w-measure text-fg-muted">{t("help")}</p>
      <form onSubmit={submit} noValidate className="mt-6 max-w-xl">
        <label className="block">
          <span className="eyebrow">{t("label")}</span>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+229"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setState("idle");
            }}
            aria-invalid={state === "invalid_phone" || state === "phone_taken" || undefined}
            className={fieldClass}
          />
        </label>
        {state !== "idle" && (
          <p role={state === "saved" || state === "removed" ? "status" : "alert"} className="mt-4 border-l border-accent pl-5 text-sm">
            {t(`states.${state}`)}
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-4">
          <Button type="submit" variant="secondary" disabled={busy}>
            {t("save")}
          </Button>
          {saved && (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void send("")}>
              {t("remove")}
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
