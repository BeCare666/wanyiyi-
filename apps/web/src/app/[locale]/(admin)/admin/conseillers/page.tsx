import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { getStaffMember } from "@/lib/staff";
import { createSupabaseServer } from "@/lib/supabase/server";
import { AssignCounselor } from "./AssignCounselor";
import { CounselorForm } from "./CounselorForm";
import { assignable, type CounselorRequest, type CounselorRow, isFull } from "./counselors";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.nav");
  return { title: t("counselors") };
}

/**
 * Conseillers (section 11.2-8 ; question 9 a, 26 octobre 2026) : profils, disponibilité, charge
 * (couples en cours sur le maximum). Création à partir du compte d'un membre, désigné par son
 * numéro ; le compte devient « conseiller » (journalisé). Attribution du conseiller aux couples
 * dont les deux membres ont accepté l'invitation (question 9, 26 octobre 2026). Permission
 * counselors.manage.
 */
export default async function AdminCounselorsPage() {
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("counselors.manage")) notFound();
  const t = await getTranslations("Admin");
  const supabase = await createSupabaseServer();
  const [result, requestsResult] = supabase
    ? await Promise.all([supabase.rpc("admin_counselors"), supabase.rpc("admin_counselor_requests")])
    : [null, null];
  const rows = (result?.data ?? []) as CounselorRow[];
  const requests = (requestsResult?.data ?? []) as CounselorRequest[];
  const choices = assignable(rows).map((r) => ({ id: r.user_id, name: r.display_name }));
  const pair = (first: string | null, n: string | null) => [first ?? "·", n ? `(${n})` : ""].filter(Boolean).join(" ");

  return (
    <div className="mx-auto max-w-4xl">
      <header>
        <p className="eyebrow">{t("groups.relations")}</p>
        <h1 className="mt-4 text-4xl">{t("nav.counselors")}</h1>
        <p className="mt-4 max-w-measure text-fg-muted">{t("counselors.intro")}</p>
      </header>

      <section aria-labelledby="demandes" className="mt-10 border-t border-line pt-8">
        <h2 id="demandes" className="text-2xl">
          {t("counselors.requests.title")}
        </h2>
        {requests.length === 0 ? (
          <p className="mt-4 text-fg-muted">{t("counselors.requests.empty")}</p>
        ) : (
          <ol className="mt-4 border-t border-line">
            {requests.map((req) => (
              <li key={req.access_id} className="border-b border-line py-5">
                <p className="font-medium">
                  {pair(req.a_first_name, req.a_number)} · {pair(req.b_first_name, req.b_number)}
                </p>
                <p className="mt-1 text-sm text-fg-muted">{t(req.include_history ? "counselors.requests.withHistory" : "counselors.requests.noHistory")}</p>
                <AssignCounselor accessId={req.access_id} counselors={choices} />
              </li>
            ))}
          </ol>
        )}
      </section>

      <h2 className="mt-12 text-2xl">{t("counselors.list")}</h2>

      {!result || result.error ? (
        <p role="alert" className="mt-10 border-l border-accent pl-5 text-fg-muted">
          {t("errors.unavailable")}
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-10 border-t border-line pt-8 text-fg-muted">{t("counselors.empty")}</p>
      ) : (
        <ul className="mt-10 border-t border-line-strong">
          {rows.map((row) => (
            <li key={row.user_id} className="border-b border-line py-6">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-4">
                  <span>
                    <span className="font-medium">{row.display_name}</span>
                    {row.member_number && <span className="ml-2 text-sm text-fg-muted">{row.member_number}</span>}
                  </span>
                  <span className="text-sm text-fg-muted">
                    {t("counselors.load", { count: row.active_couples, max: row.max_couples })}
                    {" · "}
                    {row.is_available ? (isFull(row) ? t("counselors.full") : t("counselors.available")) : t("counselors.unavailable")}
                  </span>
                </summary>
                <div className="mt-6">
                  <CounselorForm existing={row} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}

      <section aria-labelledby="nouveau-conseiller" className="mt-12 border-t border-line pt-8">
        <h2 id="nouveau-conseiller" className="text-2xl">
          {t("counselors.new")}
        </h2>
        <div className="mt-6">
          <CounselorForm />
        </div>
      </section>
    </div>
  );
}
