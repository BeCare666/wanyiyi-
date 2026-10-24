import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getSessionMember } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { dataSections, type MyData, plainText, sectionRows, valueKind } from "./data";
import { PrintButton } from "./PrintButton";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Member.myData");
  return { title: t("title") };
}

/**
 * Mes données, version lisible (question 16, 24 octobre 2026) : même contenu que le fichier JSON,
 * mis en page pour l'impression ; « Enregistrer en PDF » du navigateur produit le PDF.
 */
export default async function MyDataPage() {
  const member = await getSessionMember();
  if (!member) return null;
  const t = await getTranslations("Member.myData");
  const format = await getFormatter();
  const supabase = await createSupabaseServer();
  const { data: raw } = (await supabase?.rpc("my_data")) ?? { data: null };
  const data = raw as MyData | null;

  const show = (key: string, value: unknown): string => {
    switch (valueKind(key, value)) {
      case "empty":
        return t("empty");
      case "boolean":
        return t(value ? "yes" : "no");
      case "date":
        return format.dateTime(new Date(String(value)), { dateStyle: "long", timeZone: "UTC" });
      case "dateTime":
        return format.dateTime(new Date(String(value)), { dateStyle: "long", timeStyle: "short", timeZone: "Africa/Porto-Novo" });
      case "amount":
        return `${format.number(Number(value))} FCFA`;
      default:
        return plainText(value) || t("empty");
    }
  };
  const label = (key: string) => (t.has(`fields.${key}`) ? t(`fields.${key}`) : key);

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/espace/parametres" className="text-sm text-link underline-offset-4 hover:underline print:hidden">
        {t("back")}
      </Link>
      <header className="mt-6">
        <h1 className="text-4xl">{t("title")}</h1>
        {data && <p className="mt-4 text-fg-muted">{t("exportedAt", { date: show("exported_at", data.exported_at) })}</p>}
        <p className="mt-4 max-w-measure text-fg-muted print:hidden">{t("help")}</p>
        <div className="mt-6">
          <PrintButton />
        </div>
      </header>

      {!data ? (
        <p role="alert" className="mt-10 border-l border-accent pl-5">
          {t("unavailable")}
        </p>
      ) : (
        dataSections.map((section) => {
          const rows = sectionRows(data, section);
          return (
            <section key={section} aria-labelledby={`donnees-${section}`} className="mt-10 border-t border-line pt-6 break-inside-avoid-page">
              <h2 id={`donnees-${section}`} className="eyebrow">
                {t(`sections.${section}`)}
              </h2>
              {rows.length === 0 ? (
                <p className="mt-3 text-sm text-fg-muted">{t("none")}</p>
              ) : (
                <ul className="mt-3">
                  {rows.map((row, i) => (
                    <li key={i} className="border-b border-line py-3 last:border-b-0 break-inside-avoid">
                      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[minmax(10rem,auto)_1fr]">
                        {Object.entries(row).map(([key, value]) => (
                          <div key={key} className="contents">
                            <dt className="text-fg-muted">{label(key)}</dt>
                            <dd className="break-words">{show(key, value)}</dd>
                          </div>
                        ))}
                      </dl>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
