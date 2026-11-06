import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { systemMessage } from "@/components/member/chatSystem";
import { coupleSpace } from "@/components/member/memberNav";
import { TAB_PARAM } from "@/components/member/SpaceTabs";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { createSupabaseServer } from "@/lib/supabase/server";
import { type ChatPreview, chatTimeLabel, daysLeft, type DiscoveryRow, groupBySection, sortChats } from "./discoveries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Member.matches");
  return { title: t("title") };
}

/**
 * Mes matchs (section 9.4 ; règles du 06/11/2026) : 3 matchs au plus par soirée, chacun ouvert
 * aussitôt en discussion, sans choix à faire. Liste des discussions façon WhatsApp : la plus
 * récente en haut, dernier message, heure, messages non lus. Lecture avec le jeton du membre
 * (app.my_discoveries, app.my_discovery_chats) : prénom de l'autre seulement, jamais sa décision.
 */
export default async function MatchesPage() {
  const t = await getTranslations("Member");
  const format = await getFormatter();
  const supabase = await createSupabaseServer();
  const [result, chats] = supabase
    ? await Promise.all([supabase.rpc("my_discoveries"), supabase.rpc("my_discovery_chats")])
    : [null, null];
  const rows = (result?.data ?? []) as DiscoveryRow[];
  // Sans la mise à jour de la base du 06/11/2026, la fonction manque : liste sans aperçu
  const previews = (chats?.error ? [] : (chats?.data ?? [])) as ChatPreview[];
  const preview = new Map(previews.map((p) => [p.discovery_id, p]));
  const now = new Date();
  const sections = groupBySection(rows, now);
  const active = sortChats(sections.active, previews);
  const day = (iso: string) => format.dateTime(new Date(iso), "eventDay");
  const when = (iso: string) => {
    const label = chatTimeLabel(iso, now);
    if (label.kind === "time") return format.dateTime(label.date, { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Porto-Novo" });
    if (label.kind === "yesterday") return t("chats.yesterday");
    return format.dateTime(label.date, { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "Africa/Porto-Novo" });
  };
  const lastLine = (p: ChatPreview | undefined) => {
    if (!p?.last_body) return t("chats.empty");
    if (p.last_is_system) {
      const sys = systemMessage(p.last_body);
      return sys ? t("chats.system") : t("chats.empty");
    }
    return p.last_from_me ? t("chats.mine", { body: p.last_body }) : p.last_body;
  };

  return (
    <div className="mx-auto max-w-3xl">
      <header>
        <p className="eyebrow flex items-center gap-4">
          <span aria-hidden="true" className="block h-px w-10 bg-accent" />
          {t("nav.matches")}
        </p>
        <h1 className="mt-6 text-4xl">{t("matches.title")}</h1>
        <p className="mt-6 max-w-measure text-lg text-fg-muted">{t("discoveries.intro")}</p>
      </header>

      {!result || result.error ? (
        <p role="alert" className="mt-14 border-l border-accent pl-5 text-fg-muted">
          {t("errors.unavailable")}
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-14 border-t border-line pt-8 text-fg-muted">{t("matches.empty")}</p>
      ) : (
        <>
          {active.length > 0 && (
            <section aria-labelledby="discussions" className="mt-12">
              <h2 id="discussions" className="eyebrow">
                {t("chats.title")}
              </h2>
              <ul className="mt-4 overflow-hidden rounded-md border border-line bg-bg-elevated">
                {active.map((row) => {
                  const p = preview.get(row.discovery_id!);
                  const unread = p?.unread ?? 0;
                  return (
                    <li key={row.match_id} className="border-b border-line last:border-b-0">
                      <Link
                        href={{ pathname: `/espace/matchs/${row.discovery_id}`, query: { [TAB_PARAM]: "discussion" } }}
                        className="flex min-h-20 items-center gap-4 px-4 py-3 transition-colors hover:bg-bg focus-visible:bg-bg"
                      >
                        <span
                          aria-hidden="true"
                          className="grid size-12 shrink-0 place-items-center rounded-full bg-accent font-serif text-xl text-accent-fg"
                        >
                          {row.partner_first_name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-3">
                            <span className="truncate text-lg font-medium">{row.partner_first_name}</span>
                            {p?.last_at && (
                              <span className={cn("shrink-0 text-xs tabular-nums", unread > 0 ? "font-medium text-fg" : "text-fg-muted")}>
                                {when(p.last_at)}
                              </span>
                            )}
                          </span>
                          <span className="mt-1 flex items-center justify-between gap-3">
                            <span className={cn("truncate text-sm", unread > 0 ? "text-fg" : "text-fg-muted")}>{lastLine(p)}</span>
                            {unread > 0 && (
                              <span className="grid min-w-6 shrink-0 place-items-center rounded-full bg-accent px-1.5 text-xs font-medium tabular-nums text-accent-fg">
                                <span className="sr-only">{t("chats.unread", { count: unread })}</span>
                                <span aria-hidden="true">{unread}</span>
                              </span>
                            )}
                          </span>
                          <span className="mt-1 block text-xs text-fg-muted">
                            {t("discoveries.daysLeft", { count: daysLeft(row.ends_at!, now), date: day(row.ends_at!) })}
                            {row.extended && ` · ${t("discoveries.extended")}`}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {sections.waiting.length > 0 && (
            <section aria-labelledby="en-attente" className="mt-14">
              <h2 id="en-attente" className="eyebrow">
                {t("discoveries.waiting")}
              </h2>
              <ol className="mt-4 border-t border-line">
                {sections.waiting.map((row) => (
                  <li key={row.match_id} className="grid gap-2 border-b border-line py-7 md:grid-cols-12 md:items-baseline md:gap-8">
                    <p className="font-serif text-3xl md:col-span-5">{row.partner_first_name}</p>
                    <p className="text-sm text-fg-muted md:col-span-7">{t("discoveries.waitingHelp", { date: day(row.pending_expires_at) })}</p>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {sections.couple.length > 0 && (
            <section aria-labelledby="couple" className="mt-14">
              <h2 id="couple" className="eyebrow">
                {t("discoveries.couple")}
              </h2>
              <ol className="mt-4 border-t border-line">
                {sections.couple.map((row) => (
                  <li key={row.match_id} className="border-b border-line py-7">
                    <p className="font-serif text-3xl">{row.partner_first_name}</p>
                    <p className="mt-2 text-sm text-fg-muted">{t("discoveries.coupleHelp")}</p>
                    <Link href={coupleSpace} className="mt-4 inline-flex min-h-12 items-center text-link underline-offset-4 hover:underline">
                      {t("discoveries.coupleOpen")}
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {sections.ended.length > 0 && (
            <section aria-labelledby="terminees" className="mt-14">
              <h2 id="terminees" className="eyebrow">
                {t("discoveries.ended")}
              </h2>
              <ol className="mt-4 border-t border-line">
                {sections.ended.map((row) => (
                  <li key={row.match_id} className="grid gap-2 border-b border-line py-5 md:grid-cols-12 md:items-baseline md:gap-8">
                    <p className="text-lg md:col-span-5">{row.partner_first_name}</p>
                    <p className="text-sm text-fg-muted md:col-span-7">{t("discoveries.endedMessage")}</p>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}
    </div>
  );
}
