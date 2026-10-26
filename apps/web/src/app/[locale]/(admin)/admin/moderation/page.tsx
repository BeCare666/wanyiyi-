import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { ListFilters } from "@/components/admin/ListFilters";
import { encodeListFilter, formatListSort, listFilterQuery, moderationSpec, parseListPage, parseListState } from "@/components/admin/listRules";
import { loadListPage } from "@/components/admin/listPage";
import { ListPager, ListSummary } from "@/components/admin/ListTools";
import { ProtectedPhoto } from "@/components/ui/ProtectedPhoto";
import { getStaffMember } from "@/lib/staff";
import { createSupabaseServer } from "@/lib/supabase/server";
import { photoLink } from "./actions";
import type { ModerationRow } from "./moderation";
import { TextReview } from "./TextReview";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.nav");
  return { title: t("moderation") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Modération des textes de profil (question 22, 22 octobre 2026) : textes en attente, les plus
 * anciens d'abord ; approbation, ou refus avec motif notifié au membre. Un texte n'est visible
 * des autres membres qu'une fois approuvé. Filtres avancés (11.3), tri, colonnes, filtres
 * enregistrés et export, tout dans l'adresse. Photos à relire (phase 3, question 10) : mêmes
 * règles, affichées filigranées par un lien de 5 minutes, chaque consultation journalisée.
 * Permission profile_texts.review.
 */
export default async function ModerationPage({ searchParams }: Props) {
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("profile_texts.review")) notFound();
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const params = await searchParams;
  const page = parseListPage(params);
  const { filter, sort, columns } = parseListState(moderationSpec, params);
  const query = listFilterQuery(moderationSpec, {}, filter, sort, columns);
  const { rows, total, error, saved } = await loadListPage<ModerationRow>(moderationSpec, filter, sort, page, staff.id);
  const show = (c: string) => columns.includes(c);
  const supabase = await createSupabaseServer();
  const photosResult = supabase ? await supabase.rpc("photo_moderation_queue") : null;
  const photos = (photosResult?.data ?? []) as Array<{ photo_id: string; first_name: string | null; member_number: string | null; created_at: string }>;

  return (
    <div className="mx-auto max-w-4xl">
      <header>
        <p className="eyebrow">{t("groups.members")}</p>
        <h1 className="mt-4 text-4xl">{t("nav.moderation")}</h1>
        <p className="mt-4 max-w-measure text-fg-muted">{t("moderation.intro")}</p>
      </header>

      <section aria-labelledby="photos-a-relire" className="mt-10 border-t border-line pt-8">
        <h2 id="photos-a-relire" className="text-2xl">
          {t("moderation.photos.title")}
        </h2>
        {!photosResult || photosResult.error ? (
          <p role="alert" className="mt-4 border-l border-accent pl-5 text-fg-muted">
            {t("errors.unavailable")}
          </p>
        ) : photos.length === 0 ? (
          <p className="mt-4 text-fg-muted">{t("moderation.photos.empty")}</p>
        ) : (
          <ol className="mt-4 border-t border-line">
            {photos.map((ph) => (
              <li key={ph.photo_id} className="border-b border-line py-6">
                <p className="text-sm text-fg-muted">
                  <span className="font-medium text-fg">{ph.first_name ?? ph.member_number ?? t("verifications.noProfile")}</span>
                  {ph.member_number && ph.first_name ? ` · ${ph.member_number}` : ""} ·{" "}
                  {format.dateTime(new Date(ph.created_at), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </p>
                <div className="mt-3">
                  <ProtectedPhoto load={photoLink.bind(null, ph.photo_id)} alt={t("moderation.photos.alt", { name: ph.first_name ?? "" })} />
                </div>
                <TextReview textId={ph.photo_id} kind="photo" />
              </li>
            ))}
          </ol>
        )}
      </section>

      <h2 className="mt-12 text-2xl">{t("moderation.texts")}</h2>

      {/* La clé remet le constructeur à l'état de l'adresse après chaque navigation */}
      <ListFilters
        key={(filter ? encodeListFilter(filter) : "") + formatListSort(sort) + columns.join(",")}
        list="moderation"
        quick={{}}
        filter={filter}
        sort={sort}
        columns={columns}
        saved={saved}
      />

      {error ? (
        <p role="alert" className="mt-10 border-l border-accent pl-5 text-fg-muted">
          {t("errors.unavailable")}
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-10 border-t border-line pt-8 text-fg-muted">{t("moderation.empty")}</p>
      ) : (
        <>
          <ListSummary total={total} exportPath="/admin/moderation/export" query={query} />
          <ol className="mt-4 border-t border-line">
            {rows.map((row) => (
              <li key={row.text_id} className="border-b border-line py-6">
                <p className="text-sm text-fg-muted">
                  <span className="font-medium text-fg">{row.first_name ?? row.member_number ?? t("verifications.noProfile")}</span>
                  {row.member_number && row.first_name ? ` · ${row.member_number}` : ""}
                  {show("field") && ` · ${t(`moderation.fields.${row.field}`)}`}
                  {show("date") && ` · ${format.dateTime(new Date(row.created_at), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}
                </p>
                <blockquote className="mt-3 max-w-measure whitespace-pre-line border-l border-line pl-5">{row.body}</blockquote>
                <TextReview textId={row.text_id} />
              </li>
            ))}
          </ol>
          <ListPager pathname="/admin/moderation" query={query} page={page} total={total} />
        </>
      )}
    </div>
  );
}
