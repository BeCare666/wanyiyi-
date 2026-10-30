import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getStaffMember } from "@/lib/staff";
import { createSupabaseServer } from "@/lib/supabase/server";
import { ageOn, memberName } from "../queue";
import { MemberDetails } from "@/components/admin/MemberDetails";
import { DecisionForm } from "./DecisionForm";
import { DocumentButton } from "./DocumentButton";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.nav");
  return { title: t("verifications") };
}

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Verification = { id: string; user_id: string; status: string; correction_note: string | null; created_at: string; decided_at: string | null };
type Profile = { first_name: string; last_name: string; sex: "female" | "male"; birth_date: string; city: string | null; status: string };
type Declaration = { id: string; declared_marital_status: string; has_children: boolean | null; other_details: string | null; text_version: string; signed_at: string };
type DocumentRow = { id: string; kind: string; part: "front" | "back" | "photo_page" | "face"; uploaded_at: string };

/** Lecture du dossier avec le jeton de la personne : RLS et fonctions contrôlent la permission. */
async function loadDossier(id: string) {
  const supabase = await createSupabaseServer();
  if (!supabase) return null;
  const { data: verification } = await supabase
    .from("verifications")
    .select("id, user_id, status, correction_note, created_at, decided_at")
    .eq("id", id)
    .maybeSingle();
  if (!verification) return null;
  const v = verification as Verification;
  const [profile, user, declarations, documents] = await Promise.all([
    supabase.from("member_profiles").select("first_name, last_name, sex, birth_date, city, status").eq("user_id", v.user_id).maybeSingle(),
    supabase.from("users").select("member_number, phone").eq("id", v.user_id).maybeSingle(),
    supabase
      .from("honor_declarations")
      .select("id, declared_marital_status, has_children, other_details, text_version, signed_at")
      .eq("user_id", v.user_id)
      .order("signed_at", { ascending: false }),
    supabase.rpc("verification_documents", { p_verification: v.id }),
  ]);
  return {
    verification: v,
    profile: (profile.data as Profile | null) ?? null,
    user: (user.data as { member_number: string | null; phone: string | null } | null) ?? null,
    declarations: (declarations.data as Declaration[] | null) ?? [],
    documents: (documents.data as DocumentRow[] | null) ?? [],
  };
}

/**
 * Fiche d'un dossier (section 11.2-3) : identité déclarée, déclaration sur l'honneur et
 * son historique, pièces (ouverture journalisée par un lien de 5 minutes), décision.
 * Le compte rendu d'entretien attend l'organisation des entretiens (question 5).
 */
export default async function VerificationDetailPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("verifications.review")) notFound();
  const dossier = await loadDossier(id);
  if (!dossier) notFound();

  const t = await getTranslations("Admin.verifications");
  const tm = await getTranslations("Member.verification");
  const format = await getFormatter();
  const { verification, profile, user, declarations, documents } = dossier;
  const dateTime = (iso: string) => format.dateTime(new Date(iso), { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const [latest, ...previous] = declarations;
  // Selfie seul depuis le 22 octobre 2026 (question 29) : plus de pièce d'identité, même règle que app.dossier_complete
  const ready = Boolean(latest) && documents.some((d) => d.kind === "selfie");
  const open = verification.status === "pending" || verification.status === "to_correct";

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/admin/verifications" className="text-sm text-link underline-offset-4 hover:underline">
        {t("back")}
      </Link>
      <header className="mt-6 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-8">
        <div>
          <h1 className="text-4xl">{profile ? memberName(profile) : t("noProfile")}</h1>
          <p className="mt-3 text-fg-muted">
            {user?.member_number ?? ""}
            {user?.phone ? ` · ${user.phone}` : ""}
          </p>
        </div>
        <p className="eyebrow">{t(`status.${verification.status}`)}</p>
      </header>

      <div className="grid gap-12 py-10 lg:grid-cols-12">
        <div className="space-y-12 lg:col-span-7">
          <section aria-labelledby="identite">
            <h2 id="identite" className="eyebrow">
              {t("identity.title")}
            </h2>
            {profile ? (
              <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-8 gap-y-3 text-sm">
                <dt className="text-fg-muted">{t("identity.sex")}</dt>
                <dd>{t(`identity.sexes.${profile.sex}`)}</dd>
                <dt className="text-fg-muted">{t("identity.birthDate")}</dt>
                <dd>
                  {format.dateTime(new Date(`${profile.birth_date}T12:00:00Z`), { day: "numeric", month: "long", year: "numeric" })} ·{" "}
                  {t("identity.age", { age: ageOn(profile.birth_date, new Date()) })}
                </dd>
                <dt className="text-fg-muted">{t("identity.city")}</dt>
                <dd>{profile.city ?? "·"}</dd>
              </dl>
            ) : (
              <p className="mt-4 text-sm text-fg-muted">{t("identity.missing")}</p>
            )}
            <p className="mt-4 text-sm text-fg-muted">{t("identity.compare")}</p>
          </section>

          <section aria-labelledby="pieces">
            <h2 id="pieces" className="eyebrow">
              {t("documents.title")}
            </h2>
            {documents.length === 0 ? (
              <p className="mt-4 text-sm text-fg-muted">{t("documents.none")}</p>
            ) : (
              <ul className="mt-4 border-t border-line">
                {documents.map((doc) => {
                  const label = doc.kind === "selfie" ? tm("documents.slots.selfie") : `${tm(`documents.kinds.${doc.kind}`)} · ${t(`documents.parts.${doc.part}`)}`;
                  return (
                    <li key={doc.id} className="flex flex-wrap items-center justify-between gap-4 border-b border-line py-4">
                      <span>
                        <span className="block">{label}</span>
                        <span className="block text-xs text-fg-muted">{dateTime(doc.uploaded_at)}</span>
                      </span>
                      <DocumentButton documentId={doc.id} label={t("documents.open")} />
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-4 text-xs text-fg-muted">{t("documents.audit")}</p>
          </section>

          <section aria-labelledby="declaration">
            <h2 id="declaration" className="eyebrow">
              {t("declaration.title")}
            </h2>
            {latest ? (
              <div className="mt-4">
                <p>
                  {tm(`declaration.statuses.${latest.declared_marital_status}`)} ·{" "}
                  {tm(latest.has_children ? "declaration.withChildren" : "declaration.withoutChildren")}
                </p>
                {latest.other_details && <p className="mt-2 border-l border-accent pl-4">{latest.other_details}</p>}
                <p className="mt-2 text-xs text-fg-muted">{t("declaration.signed", { date: dateTime(latest.signed_at), version: latest.text_version })}</p>
                {previous.length > 0 && (
                  <details className="mt-4 text-sm">
                    <summary className="cursor-pointer text-link">{t("declaration.history", { count: previous.length })}</summary>
                    <ul className="mt-3 space-y-2 text-fg-muted">
                      {previous.map((d) => (
                        <li key={d.id}>
                          {dateTime(d.signed_at)} : {tm(`declaration.statuses.${d.declared_marital_status}`)}
                          {d.other_details ? ` (${d.other_details})` : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            ) : (
              <p className="mt-4 text-sm text-fg-muted">{t("declaration.none")}</p>
            )}
          </section>
        </div>

        <aside aria-labelledby="decision" className="lg:col-span-5">
          <div className="border border-line p-6">
            <h2 id="decision" className="font-serif text-2xl">
              {t("decision.title")}
            </h2>
            {verification.status === "to_correct" && verification.correction_note && (
              <p className="mt-4 text-sm">
                <span className="text-fg-muted">{t("decision.lastNote")} </span>
                {verification.correction_note}
              </p>
            )}
            <div className="mt-6">
              {open ? (
                <DecisionForm verificationId={verification.id} ready={ready} />
              ) : (
                <p className="text-sm text-fg-muted">
                  {t("decision.closed", { date: verification.decided_at ? dateTime(verification.decided_at) : "" })}
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* Profil complet pour décider : e-mail, réponses, textes et photos (29 octobre 2026) */}
      <MemberDetails userId={verification.user_id} name={profile ? (memberName(profile) ?? "") : ""} />
    </div>
  );
}
