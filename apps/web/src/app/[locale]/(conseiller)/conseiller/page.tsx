import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { FollowedCouple } from "./counselor";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Counselor.couples");
  return { title: t("title") };
}

/**
 * Couples suivis (section 7) : ceux où l'administration a désigné le conseiller et où l'accès est en
 * cours. Prénoms seulement ; un couple disparaît dès que l'un des deux retire le conseiller.
 */
export default async function CounselorHomePage() {
  const t = await getTranslations("Counselor");
  const format = await getFormatter();
  const supabase = await createSupabaseServer();
  const result = supabase ? await supabase.rpc("counselor_couples") : null;
  const couples = (result?.data ?? []) as FollowedCouple[];

  return (
    <div className="mx-auto max-w-5xl">
      <header>
        <p className="eyebrow flex items-center gap-4">
          <span aria-hidden="true" className="block h-px w-10 bg-accent" />
          {t("areaLabel")}
        </p>
        <h1 className="mt-6 text-4xl">{t("couples.title")}</h1>
        <p className="mt-6 max-w-measure text-lg text-fg-muted">{t("couples.intro")}</p>
      </header>

      {!result || result.error ? (
        <p role="alert" className="mt-14 border-l border-accent pl-5 text-fg-muted">
          {t("errors.unavailable")}
        </p>
      ) : couples.length === 0 ? (
        <p className="mt-14 border-t border-line pt-8 text-fg-muted">{t("couples.empty")}</p>
      ) : (
        <ol className="mt-14 border-t border-line">
          {couples.map((c) => (
            <li key={c.couple_id} className="grid gap-3 border-b border-line py-7 md:grid-cols-12 md:items-baseline md:gap-8">
              <div className="md:col-span-5">
                <Link href={`/conseiller/couples/${c.couple_id}`} className="font-serif text-3xl underline-offset-8 hover:underline">
                  {t("couples.pair", { a: c.a_first_name, b: c.b_first_name })}
                </Link>
              </div>
              <p className="text-sm text-fg-muted md:col-span-4">
                {t(`couples.status.${c.status}`)}
                {c.blocked && ` · ${t("couples.blocked")}`}
                <span className="block">{t("couples.since", { date: format.dateTime(new Date(c.granted_at), { dateStyle: "long" }) })}</span>
              </p>
              <p className="text-sm md:col-span-3 md:text-right">{c.unread > 0 ? t("couples.unread", { count: c.unread }) : t("couples.upToDate")}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
