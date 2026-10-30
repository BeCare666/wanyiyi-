import { PROFILE_CATALOG } from "@wanyiyi/shared";
import { getTranslations } from "next-intl/server";
import { photoLink } from "@/app/[locale]/(admin)/admin/moderation/actions";
import { TextReview } from "@/app/[locale]/(admin)/admin/moderation/TextReview";
import { ProtectedPhoto } from "@/components/ui/ProtectedPhoto";
import { getStaffMember } from "@/lib/staff";
import { createSupabaseServer } from "@/lib/supabase/server";

type ReviewStatus = "pending" | "approved" | "rejected";
type Details = {
  email: string | null;
  answers: { side: "self" | "seeking"; category: string; values: string[] }[];
  dealbreakers: string[];
  texts: { field: string; body: string; review_status: ReviewStatus; review_note: string | null }[];
  photos: { photo_id: string; review_status: ReviewStatus; review_note: string | null }[];
};

const categoryOrder = new Map<string, number>(PROFILE_CATALOG.map((c, i) => [c.key, i]));

/**
 * Profil complet d'un membre pour décider (décision du 29 octobre 2026), sur sa fiche et sur son
 * dossier de vérification : adresse e-mail, réponses (moi et recherché, critères non négociables),
 * textes et photos avec leur état de relecture. Lu avec le jeton de la personne
 * (app.admin_member_details : permission members.manage ou verifications.review).
 * Une photo en relecture s'approuve ou se refuse ici (30 octobre 2026), avec la permission de
 * la modération (app.review_photo).
 */
export async function MemberDetails({ userId, name }: { userId: string; name: string }) {
  const t = await getTranslations("Admin.details");
  const tProfile = await getTranslations("Profile");
  const tMember = await getTranslations("Member.profile");
  const supabase = await createSupabaseServer();
  const [result, staff] = await Promise.all([supabase ? supabase.rpc("admin_member_details", { p_user: userId }) : null, getStaffMember()]);
  const canReview = staff?.permissions.includes("profile_texts.review") ?? false;
  const details = result && !result.error ? (result.data as Details) : null;

  if (!details) {
    return (
      <section aria-labelledby="profil-complet" className="mt-12 border-t border-line pt-8">
        <h2 id="profil-complet" className="text-2xl">{t("title")}</h2>
        <p className="mt-4 text-fg-muted">{t("unavailable")}</p>
      </section>
    );
  }

  const label = (category: string, value: string) =>
    value === "indifferent"
      ? tMember("indifferent")
      : tProfile.has(`${category}.options.${value}`)
        ? tProfile(`${category}.options.${value}`)
        : value;
  const title = (category: string) => (tProfile.has(`${category}.title`) ? tProfile(`${category}.title`) : category);
  const sorted = [...details.answers].sort((a, b) => (categoryOrder.get(a.category) ?? 99) - (categoryOrder.get(b.category) ?? 99));
  const status = (s: ReviewStatus, note: string | null) => (
    <span className={s === "rejected" ? "text-fg" : "text-fg-muted"}>
      {t(`status.${s}`)}
      {s === "rejected" && note ? ` · ${t("rejectedNote", { note })}` : ""}
    </span>
  );

  return (
    <section aria-labelledby="profil-complet" className="mt-12 border-t border-line pt-8">
      <h2 id="profil-complet" className="text-2xl">{t("title")}</h2>

      <dl className="mt-6 text-sm">
        <dt className="text-fg-muted">{t("email")}</dt>
        <dd className="mt-1 break-all">{details.email ?? t("noEmail")}</dd>
      </dl>

      <h3 className="eyebrow mt-10">{t("answers")}</h3>
      {sorted.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">{t("noAnswers")}</p>
      ) : (
        <div className="mt-4 grid gap-10 lg:grid-cols-2">
          {(["self", "seeking"] as const).map((side) => {
            const answers = sorted.filter((a) => a.side === side);
            return (
              <div key={side}>
                <p className="font-medium">{tMember(`tabs.${side}`)}</p>
                {answers.length === 0 ? (
                  <p className="mt-3 text-sm text-fg-muted">{t("noAnswers")}</p>
                ) : (
                  <dl className="mt-3 border-t border-line text-sm">
                    {answers.map((a) => (
                      <div key={a.category} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 border-b border-line py-2">
                        <dt className="text-fg-muted">{title(a.category)}</dt>
                        <dd>
                          {a.values.map((v) => label(a.category, v)).join(", ")}
                          {side === "seeking" && details.dealbreakers.includes(a.category) && (
                            <span className="block text-xs font-medium">{tMember("dealbreaker")}</span>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            );
          })}
        </div>
      )}

      <h3 className="eyebrow mt-10">{t("texts")}</h3>
      {details.texts.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">{t("noTexts")}</p>
      ) : (
        <ul className="mt-4 border-t border-line text-sm">
          {details.texts.map((text) => (
            <li key={text.field} className="border-b border-line py-4">
              <p className="text-fg-muted">{tMember(`texts.fields.${text.field}`)}</p>
              <p className="mt-2 max-w-measure whitespace-pre-line">{text.body}</p>
              <p className="mt-2 text-xs">{status(text.review_status, text.review_note)}</p>
            </li>
          ))}
        </ul>
      )}

      <h3 className="eyebrow mt-10">{t("photos")}</h3>
      {details.photos.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">{t("noPhotos")}</p>
      ) : (
        <ul className="mt-4 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {details.photos.map((photo, i) => (
            <li key={photo.photo_id}>
              <div className="max-w-xs">
                <ProtectedPhoto load={photoLink.bind(null, photo.photo_id, false)} alt={t("photoAlt", { rank: i + 1, name })} />
              </div>
              <p className="mt-2 text-xs">{status(photo.review_status, photo.review_note)}</p>
              {canReview && photo.review_status === "pending" && <TextReview textId={photo.photo_id} kind="photo" />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
