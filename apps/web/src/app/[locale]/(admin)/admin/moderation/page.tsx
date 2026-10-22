import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { getStaffMember } from "@/lib/staff";
import { createSupabaseServer } from "@/lib/supabase/server";
import { TextReview } from "./TextReview";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.nav");
  return { title: t("moderation") };
}

type QueueRow = {
  text_id: string;
  user_id: string;
  first_name: string | null;
  member_number: string | null;
  field: "who_i_am" | "what_matters" | "evening_topic";
  body: string;
  created_at: string;
};

/**
 * Modération des textes de profil (question 22, 22 octobre 2026) : textes en attente, les plus
 * anciens d'abord ; approbation, ou refus avec motif notifié au membre. Un texte n'est visible
 * des autres membres qu'une fois approuvé. Permission profile_texts.review.
 */
export default async function ModerationPage() {
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("profile_texts.review")) notFound();
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const supabase = await createSupabaseServer();
  const result = supabase ? await supabase.rpc("moderation_queue") : null;
  const rows = (result?.data ?? []) as QueueRow[];

  return (
    <div className="mx-auto max-w-4xl">
      <header>
        <p className="eyebrow">{t("groups.members")}</p>
        <h1 className="mt-4 text-4xl">{t("nav.moderation")}</h1>
        <p className="mt-4 max-w-measure text-fg-muted">{t("moderation.intro")}</p>
      </header>

      {!result || result.error ? (
        <p role="alert" className="mt-10 border-l border-accent pl-5 text-fg-muted">
          {t("errors.unavailable")}
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-10 border-t border-line pt-8 text-fg-muted">{t("moderation.empty")}</p>
      ) : (
        <>
          <p className="mt-10 text-sm text-fg-muted" role="status">
            {t("moderation.count", { count: rows.length })}
          </p>
          <ol className="mt-4 border-t border-line">
            {rows.map((row) => (
              <li key={row.text_id} className="border-b border-line py-6">
                <p className="text-sm text-fg-muted">
                  <span className="font-medium text-fg">{row.first_name ?? row.member_number ?? t("verifications.noProfile")}</span>
                  {row.member_number && row.first_name ? ` · ${row.member_number}` : ""} · {t(`moderation.fields.${row.field}`)} ·{" "}
                  {format.dateTime(new Date(row.created_at), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </p>
                <blockquote className="mt-3 max-w-measure whitespace-pre-line border-l border-line pl-5">{row.body}</blockquote>
                <TextReview textId={row.text_id} />
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
