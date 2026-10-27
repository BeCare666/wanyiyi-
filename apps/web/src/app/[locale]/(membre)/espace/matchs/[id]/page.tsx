import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { type ChatMessage, ChatRoom } from "@/components/member/ChatRoom";
import { type FirstDateVenue, FirstDateVenues } from "@/components/member/FirstDateVenues";
import { ProtectedPhoto } from "@/components/ui/ProtectedPhoto";
import { coupleSpace } from "@/components/member/memberNav";
import { Link } from "@/i18n/navigation";
import { getSessionMember } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { DateForm } from "../../couple/CoupleActions";
import { declareDiscoveryDate, partnerPhotoLink, reportConversation, sendMessage } from "../actions";
import { canAskExtension, daysLeft, type DiscoveryRow } from "../discoveries";
import { DiscoveryDecisions } from "../DiscoveryActions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Member.discoveries");
  return { title: t("title") };
}

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Une découverte (section 9.4) : conversation simple sans conseiller, en temps réel, photos de
 * l'autre personne révélées (10.2, filigranées à mon nom), décisions. Tout est lu avec le jeton
 * du membre : une découverte qui n'est pas la sienne est introuvable.
 */
export default async function DiscoveryPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const member = await getSessionMember();
  const supabase = await createSupabaseServer();
  if (!member || !supabase) notFound();
  const t = await getTranslations("Member");
  const format = await getFormatter();

  const { data: rows } = await supabase.rpc("my_discoveries");
  const row = ((rows ?? []) as DiscoveryRow[]).find((r) => r.discovery_id === id);
  if (!row) notFound();
  const [{ data: match }, { data: conversation }] = await Promise.all([
    supabase.from("matches").select("member_a, member_b").eq("id", row.match_id).maybeSingle(),
    supabase.from("conversations").select("id, closed_at, read_only").eq("discovery_id", id).maybeSingle(),
  ]);
  const partner = match ? (match.member_a === member.id ? match.member_b : match.member_a) : null;
  const [{ data: photos }, { data: messages }] = await Promise.all([
    partner
      ? supabase.from("photos").select("id").eq("user_id", partner).eq("review_status", "approved").order("position")
      : Promise.resolve({ data: [] as { id: string }[] }),
    conversation
      ? supabase.from("messages").select("id, sender_id, body, created_at, is_system").eq("conversation_id", conversation.id).order("created_at").limit(500)
      : Promise.resolve({ data: [] as ChatMessage[] }),
  ]);
  // Conversation affichée : elle ne compte plus dans les messages non lus du tableau de bord
  const active = row.discovery_status === "active" || row.discovery_status === "extended";
  const [{ data: venues }, { data: dates }] = active
    ? await Promise.all([supabase.rpc("first_date_venues"), supabase.rpc("my_discovery_dates", { p_discovery: id })])
    : [{ data: [] }, { data: [] }];
  if (conversation && active) await supabase.rpc("mark_conversation_read", { p_conversation: conversation.id });

  return (
    <div className="mx-auto max-w-4xl">
      <p>
        <Link href="/espace/matchs" className="text-sm text-link underline-offset-4 hover:underline">
          {t("discoveries.back")}
        </Link>
      </p>
      <header className="mt-6">
        <p className="eyebrow">{t("discoveries.title")}</p>
        <h1 className="mt-4 font-serif text-4xl">{row.partner_first_name}</h1>
        <p className="mt-3 text-sm text-fg-muted">
          {active
            ? t("discoveries.daysLeft", { count: daysLeft(row.ends_at!, new Date()), date: format.dateTime(new Date(row.ends_at!), "eventDay") })
            : row.discovery_status === "continued"
              ? t("discoveries.coupleHelp")
              : t("discoveries.endedMessage")}
        </p>
        <p className="mt-3 max-w-measure text-sm text-fg-muted">{t("discoveries.advice")}</p>
      </header>

      {active && (
        <DiscoveryDecisions
          discoveryId={id}
          wantsToContinue={row.i_want_to_continue}
          wantsExtension={row.i_want_extension}
          canExtend={canAskExtension(row, new Date())}
        />
      )}

      {active && <FirstDateVenues venues={(venues ?? []) as FirstDateVenue[]} />}

      {/* Rendez-vous déclarés (question 5) : « Bien rentré(e) ? » 3 heures après */}
      {active && (
        <section aria-labelledby="rendez-vous" className="mt-14">
          <h2 id="rendez-vous" className="eyebrow">
            {t("couple.dates.title")}
          </h2>
          <p className="mt-3 max-w-measure text-sm text-fg-muted">{t("couple.dates.help")}</p>
          <DateForm declare={declareDiscoveryDate.bind(null, id)} />
          {((dates ?? []) as { id: string; date_at: string; declared_by_me: boolean }[]).length > 0 && (
            <ul className="mt-6 border-t border-line">
              {((dates ?? []) as { id: string; date_at: string; declared_by_me: boolean }[]).map((d) => (
                <li key={d.id} className="flex flex-wrap justify-between gap-4 border-b border-line py-4">
                  <span>{format.dateTime(new Date(d.date_at), { dateStyle: "long", timeStyle: "short", timeZone: "Africa/Porto-Novo" })}</span>
                  <span className="text-sm text-fg-muted">
                    {d.declared_by_me ? t("couple.dates.byMe") : t("couple.dates.byPartner", { name: row.partner_first_name })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {active && (photos ?? []).length > 0 && (
        <section aria-labelledby="photos" className="mt-10">
          <h2 id="photos" className="eyebrow">
            {t("discoveries.photos")}
          </h2>
          <ul className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {(photos ?? []).map((p, i) => (
              <li key={p.id}>
                <ProtectedPhoto load={partnerPhotoLink.bind(null, p.id)} alt={t("discoveries.photoAlt", { name: row.partner_first_name, rank: i + 1 })} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Question 14 : une découverte terminée n'est plus lisible ; devenue couple, elle se relit dans l'espace du couple */}
      {row.discovery_status === "continued" && (
        <p className="mt-8">
          <Link href={coupleSpace} className="text-link underline-offset-4 hover:underline">
            {t("discoveries.coupleOpen")}
          </Link>
        </p>
      )}

      {conversation && active && (
        <ChatRoom
          conversationId={conversation.id}
          memberId={member.id}
          initial={(messages ?? []) as ChatMessage[]}
          closed={conversation.closed_at !== null || conversation.read_only}
          send={sendMessage}
          report={reportConversation}
        />
      )}
    </div>
  );
}
