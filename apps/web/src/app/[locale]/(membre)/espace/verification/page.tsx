import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { getSessionMember } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { DeclarationForm } from "./DeclarationForm";
import { SelfieForm } from "./SelfieForm";
import { canSubmit, type MyVerification } from "./verification";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Member.verification");
  return { title: t("title") };
}

/** Suivi du dossier (app.my_verification) : null tant que rien n'a été déposé. */
async function myVerification(): Promise<{ ok: true; data: MyVerification | null } | { ok: false }> {
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false };
  const { data, error } = await supabase.rpc("my_verification");
  if (error) return { ok: false };
  return { ok: true, data: ((data as MyVerification[] | null) ?? [])[0] ?? null };
}

/** Élément déjà déposé : son résumé, et le formulaire pour le remplacer tant que le dossier est ouvert. */
function Submitted({ summary, replaceLabel, open, children }: { summary: ReactNode; replaceLabel: string; open: boolean; children?: ReactNode }) {
  return (
    <>
      {summary}
      {children && (
        <details className="mt-6" open={open}>
          <summary className="cursor-pointer text-sm text-link underline-offset-4 hover:underline">{replaceLabel}</summary>
          <div className="mt-6">{children}</div>
        </details>
      )}
    </>
  );
}

/**
 * Vérification (section 6.2-2) : déclaration sur l'honneur et selfie (plus de pièce d'identité,
 * question 29 du 22 octobre 2026), suivi de l'état. L'entretien et les frais d'inscription attendent les questions 2 et 5
 * (PHASE2.txt). Les fichiers déposés ne sont jamais relus par le membre (10.1).
 */
export default async function VerificationPage() {
  const t = await getTranslations("Member.verification");
  const format = await getFormatter();
  const member = await getSessionMember();
  if (!member) return null;
  const result = await myVerification();

  if (!result.ok) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-4xl">{t("title")}</h1>
        <p role="alert" className="mt-14 border-l border-accent pl-5 text-fg-muted">
          {t("errors.unavailable")}
        </p>
      </div>
    );
  }

  const v = result.data;
  const open = canSubmit(v);
  const toCorrect = v?.status === "to_correct";
  const dateOf = (iso: string) => format.dateTime(new Date(iso), { day: "numeric", month: "long", year: "numeric" });
  const trackingKey = v?.status ?? "not_started";

  return (
    <div className="mx-auto max-w-5xl">
      <header>
        <p className="eyebrow flex items-center gap-4">
          <span aria-hidden="true" className="block h-px w-10 bg-accent" />
          {t("eyebrow")}
        </p>
        <h1 className="mt-6 text-4xl">{t("title")}</h1>
        <p className="mt-6 max-w-measure text-lg text-fg-muted">{t("intro")}</p>
      </header>

      <section aria-labelledby="suivi" className="mt-12 border-l border-accent pl-6">
        <h2 id="suivi" className="eyebrow">
          {t("tracking.title")}
        </h2>
        <p className="mt-3 font-serif text-2xl">{t(`tracking.status.${trackingKey}`)}</p>
        <p className="mt-2 max-w-measure text-fg-muted">{t(`tracking.help.${trackingKey}`)}</p>
        {toCorrect && v.correction_note && (
          <p className="mt-4 max-w-measure">
            <span className="font-medium">{t("tracking.note")} </span>
            {v.correction_note}
          </p>
        )}
      </section>

      <div className="mt-14 border-t border-line">
        <section aria-labelledby="declaration" className="grid gap-4 border-b border-line py-10 md:grid-cols-12 md:gap-8">
          <div className="md:col-span-4">
            <h2 id="declaration" className="font-serif text-2xl">
              {t("declaration.title")}
            </h2>
            <p className="mt-3 text-sm text-fg-muted">{t("declaration.intro")}</p>
          </div>
          <div className="md:col-span-8">
            {v?.signed_at && v.declared_status ? (
              <Submitted
                open={toCorrect}
                replaceLabel={t("declaration.replace")}
                summary={
                  <div>
                    <p className="font-medium">{t("declaration.signedOn", { date: dateOf(v.signed_at) })}</p>
                    <p className="mt-2 text-fg-muted">
                      {t(`declaration.statuses.${v.declared_status}`)} · {t(v.has_children ? "declaration.withChildren" : "declaration.withoutChildren")}
                    </p>
                    {v.other_details && <p className="mt-2 text-fg-muted">{v.other_details}</p>}
                  </div>
                }
              >
                {open ? <DeclarationForm /> : undefined}
              </Submitted>
            ) : open ? (
              <DeclarationForm />
            ) : null}
          </div>
        </section>

        <section aria-labelledby="pieces" className="grid gap-4 border-b border-line py-10 md:grid-cols-12 md:gap-8">
          <div className="md:col-span-4">
            <h2 id="pieces" className="font-serif text-2xl">
              {t("documents.title")}
            </h2>
            <p className="mt-3 text-sm text-fg-muted">{t("documents.intro")}</p>
          </div>
          <div className="md:col-span-8">
            {v?.has_selfie && v.documents_at ? (
              <Submitted
                open={toCorrect}
                replaceLabel={t("documents.replace")}
                summary={
                  <div>
                    <p className="font-medium">{t("documents.sentOn", { date: dateOf(v.documents_at) })}</p>
                    <p className="mt-2 text-fg-muted">{t("documents.selfieSent")}</p>
                    <p className="mt-2 text-sm text-fg-muted">{t("documents.private")}</p>
                  </div>
                }
              >
                {open ? <SelfieForm userId={member.id} /> : undefined}
              </Submitted>
            ) : open ? (
              <SelfieForm userId={member.id} />
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
