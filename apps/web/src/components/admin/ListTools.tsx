import { getTranslations } from "next-intl/server";
import { exportFormats } from "@/app/[locale]/(admin)/admin/membres/exporting";
import { pageCount } from "@/app/[locale]/(admin)/admin/membres/members";
import { Link } from "@/i18n/navigation";

type Query = Record<string, string>;

/** Nombre de résultats et liens d'export du résultat filtré (11.3 ; 5 000 lignes, journalisé par la base). */
export async function ListSummary({ total, exportPath, query }: { total: number; exportPath: string; query: Query }) {
  const t = await getTranslations("Admin");
  return (
    <>
      <div className="mt-10 flex flex-wrap items-center justify-between gap-4 text-sm">
        <p className="text-fg-muted" role="status">
          {t("lists.count", { count: total })}
        </p>
        <p className="flex flex-wrap items-center gap-4">
          <span className="text-fg-muted">{t("members.export.label")}</span>
          {exportFormats.map((format) => (
            <Link key={format} href={{ pathname: exportPath, query: { ...query, format } }} prefetch={false} className="text-link underline-offset-4 hover:underline">
              {t(`members.export.formats.${format}`)}
            </Link>
          ))}
        </p>
      </div>
      {total > 5000 && <p className="mt-2 text-xs text-fg-muted">{t("members.export.limit", { max: 5000 })}</p>}
    </>
  );
}

/** Pages précédente et suivante (pagination côté serveur), en gardant les filtres de l'adresse. */
export async function ListPager({ pathname, query, page, total }: { pathname: string; query: Query; page: number; total: number }) {
  const t = await getTranslations("Admin");
  const pages = pageCount(total);
  if (pages <= 1) return null;
  const href = (p: number) => ({ pathname, query: { ...query, ...(p > 1 ? { page: String(p) } : {}) } });
  return (
    <nav aria-label={t("members.pagination")} className="mt-8 flex items-center justify-between gap-4 text-sm">
      {page > 1 ? (
        <Link href={href(page - 1)} className="text-link underline-offset-4 hover:underline">
          {t("members.previous")}
        </Link>
      ) : (
        <span />
      )}
      <span className="text-fg-muted">{t("members.page", { page, pages })}</span>
      {page < pages ? (
        <Link href={href(page + 1)} className="text-link underline-offset-4 hover:underline">
          {t("members.next")}
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
