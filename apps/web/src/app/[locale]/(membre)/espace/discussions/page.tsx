import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { systemMessage } from "@/components/member/chatSystem";
import { TAB_PARAM } from "@/components/member/SpaceTabs";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { createSupabaseServer } from "@/lib/supabase/server";
import { chatTimeLabel, daysLeft } from "../matchs/discoveries";
import { conversationHref, type ConversationRow, initial, splitConversations } from "./discussions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Member.inbox");
  return { title: t("title") };
}

/**
 * Discussions (demande du 13/11/2026) : toutes les discussions du membre, façon WhatsApp.
 * Matchs en cours, couple, conseiller sollicité seul, puis découvertes terminées en lecture seule
 * (relisibles jusqu'à leur effacement, 90 jours). Lecture avec le jeton du membre (app.my_conversations).
 * Chaque ligne ouvre la page qui existe déjà pour cet espace.
 */
export default async function DiscussionsPage() {
  const t = await getTranslations("Member");
  const format = await getFormatter();
  const supabase = await createSupabaseServer();
  const result = supabase ? await supabase.rpc("my_conversations") : null;
  const rows = (result?.data ?? []) as ConversationRow[];
  const { current, ended } = splitConversations(rows);
  const now = new Date();
  const day = (iso: string) => format.dateTime(new Date(iso), "eventDay");
  const when = (iso: string) => {
    const label = chatTimeLabel(iso, now);
    if (label.kind === "time") return format.dateTime(label.date, { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Porto-Novo" });
    if (label.kind === "yesterday") return t("chats.yesterday");
    return format.dateTime(label.date, { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "Africa/Porto-Novo" });
  };
  const lastLine = (row: ConversationRow) => {
    if (!row.last_body) return t("chats.empty");
    if (row.last_is_system) return systemMessage(row.last_body) ? t("chats.system") : t("chats.empty");
    return row.last_from_me ? t("chats.mine", { body: row.last_body }) : row.last_body;
  };
  const detail = (row: ConversationRow) => {
    if (row.kind === "discovery") return row.ends_at ? t("discoveries.daysLeft", { count: daysLeft(row.ends_at, now), date: day(row.ends_at) }) : t("inbox.kinds.discovery");
    if (row.kind === "discovery_ended") return row.delete_after ? t("inbox.endedUntil", { date: day(row.delete_after) }) : t("inbox.kinds.discovery_ended");
    return t(`inbox.kinds.${row.kind}`);
  };

  const href = (row: ConversationRow) => {
    const target = conversationHref(row);
    return target.tab ? { pathname: target.pathname, query: { [TAB_PARAM]: target.tab } } : target.pathname;
  };

  const list = (items: ConversationRow[], muted: boolean) => (
    <ul className="mt-4 overflow-hidden rounded-md border border-line bg-bg-elevated">
      {items.map((row) => {
        const unread = row.unread ?? 0;
        return (
          <li key={row.conversation_id} className="border-b border-line last:border-b-0">
            <Link
              href={href(row)}
              className="flex min-h-20 items-center gap-4 px-4 py-3 transition-colors hover:bg-bg focus-visible:bg-bg"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-12 shrink-0 place-items-center rounded-full font-serif text-xl",
                  muted ? "bg-bg-soft text-fg-muted" : row.kind === "counsel" ? "bg-fg text-bg" : "bg-accent text-accent-fg",
                )}
              >
                {initial(row.title)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className={cn("truncate text-lg font-medium", muted && "text-fg-muted")}>
                    {row.title ?? t(`inbox.kinds.${row.kind}`)}
                  </span>
                  {row.last_at && (
                    <span className={cn("shrink-0 text-xs tabular-nums", unread > 0 ? "font-medium text-fg" : "text-fg-muted")}>{when(row.last_at)}</span>
                  )}
                </span>
                <span className="mt-1 flex items-center justify-between gap-3">
                  <span className={cn("truncate text-sm", unread > 0 ? "text-fg" : "text-fg-muted")}>{lastLine(row)}</span>
                  {unread > 0 && (
                    <span className="grid min-w-6 shrink-0 place-items-center rounded-full bg-accent px-1.5 text-xs font-medium tabular-nums text-accent-fg">
                      <span className="sr-only">{t("chats.unread", { count: unread })}</span>
                      <span aria-hidden="true">{unread}</span>
                    </span>
                  )}
                </span>
                <span className="mt-1 block text-xs text-fg-muted">{detail(row)}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="mx-auto max-w-3xl">
      <header>
        <p className="eyebrow flex items-center gap-4">
          <span aria-hidden="true" className="block h-px w-10 bg-accent" />
          {t("nav.discussions")}
        </p>
        <h1 className="mt-6 text-4xl">{t("inbox.title")}</h1>
        <p className="mt-6 max-w-measure text-lg text-fg-muted">{t("inbox.intro")}</p>
      </header>

      {!result || result.error ? (
        <p role="alert" className="mt-14 border-l border-accent pl-5 text-fg-muted">
          {t("errors.unavailable")}
        </p>
      ) : rows.length === 0 ? (
        <div className="mt-14 border-t border-line pt-8">
          <p className="text-fg-muted">{t("inbox.empty")}</p>
          <Link href="/espace/soirees" className="mt-4 inline-flex min-h-12 items-center text-link underline-offset-4 hover:underline">
            {t("inbox.emptyAction")}
          </Link>
        </div>
      ) : (
        <>
          {current.length > 0 && (
            <section aria-labelledby="en-cours" className="mt-12">
              <h2 id="en-cours" className="eyebrow">
                {t("inbox.current")}
              </h2>
              {list(current, false)}
            </section>
          )}
          {ended.length > 0 && (
            <section aria-labelledby="terminees" className="mt-14">
              <h2 id="terminees" className="eyebrow">
                {t("inbox.ended")}
              </h2>
              <p className="mt-3 max-w-measure text-sm text-fg-muted">{t("inbox.endedHelp")}</p>
              {list(ended, true)}
            </section>
          )}
        </>
      )}
    </div>
  );
}
