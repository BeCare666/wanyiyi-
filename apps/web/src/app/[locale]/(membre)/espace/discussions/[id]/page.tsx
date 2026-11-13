import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { type ChatMessage, ChatRoom, type ChatScreen } from "@/components/member/ChatRoom";
import { TAB_PARAM } from "@/components/member/SpaceTabs";
import { getSessionMember } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { CounselChat } from "../../conseiller/CounselChat";
import type { CounselRow } from "../../conseiller/counsel";
import { markConversationRead, reportConversation, sendMessage } from "../../matchs/actions";
import { daysLeft } from "../../matchs/discoveries";
import { conversationHref, type ConversationRow, initial } from "../discussions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Member.inbox");
  return { title: t("title") };
}

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Écran de discussion plein écran façon WhatsApp (validé le 13/11/2026 sur aperçu) : barre du haut
 * (retour, avatar, prénom, état), messages sur toute la hauteur, zone d'écriture en bas, menu ⋮
 * (signaler, page complète). Même discussion, mêmes règles que sur les pages de chaque espace :
 * tout est lu avec le jeton du membre (app.my_conversations) ; une discussion qui n'est pas la
 * sienne est introuvable. Sur téléphone, l'écran recouvre l'en-tête et la barre du bas.
 */
export default async function ConversationPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const member = await getSessionMember();
  const supabase = await createSupabaseServer();
  if (!member || !supabase) notFound();
  const t = await getTranslations("Member");
  const format = await getFormatter();

  const { data: rows } = await supabase.rpc("my_conversations");
  const row = ((rows ?? []) as ConversationRow[]).find((r) => r.conversation_id === id);
  if (!row) notFound();

  const { data: messages } = await supabase
    .from("messages")
    .select("id, sender_id, body, created_at, is_system")
    .eq("conversation_id", id)
    .order("created_at")
    .limit(500);
  const chat = (messages ?? []) as ChatMessage[];
  const ended = row.kind === "discovery_ended";
  if (!ended) await supabase.rpc("mark_conversation_read", { p_conversation: id });
  // Accusé de lecture (✓✓) entre les deux membres ; sans objet avec le conseiller seul
  const { data: partnerReadAt } =
    row.kind === "discovery" || row.kind === "couple" ? await supabase.rpc("conversation_partner_read_at", { p_conversation: id }) : { data: null };

  const title = row.title ?? t(`inbox.kinds.${row.kind}`);
  const subtitle =
    row.kind === "discovery" && row.ends_at
      ? t("inbox.status.discovery", { count: daysLeft(row.ends_at, new Date()) })
      : row.kind === "discovery_ended" && row.delete_after
        ? t("inbox.endedUntil", { date: format.dateTime(new Date(row.delete_after), "eventDay") })
        : t(`inbox.status.${row.kind === "discovery" ? "discoveryNoDate" : row.kind}`);
  const full = conversationHref(row);
  const screen: ChatScreen = {
    back: "/espace/discussions",
    backLabel: t("inbox.menu.back"),
    avatar: initial(row.title),
    title,
    subtitle,
    menuLabel: t("inbox.menu.label"),
    links: [{ href: full.tab ? { pathname: full.pathname, query: { [TAB_PARAM]: full.tab } } : full.pathname, label: t(`inbox.menu.full.${row.kind}`) }],
  };
  // Prénoms au-dessus des messages (couple, conseiller présent) : même règle que la page du couple ;
  // l'autre membre, le conseiller actuel par son nom, un ancien conseiller sous « Conseiller »
  const names: Record<string, string> = { [member.id]: member.firstName ?? t("chat.me") };
  if (row.kind === "couple" && row.target_id) {
    const [{ data: pair }, { data: access }, { data: coupleRows }] = await Promise.all([
      supabase.from("couples").select("member_a, member_b").eq("id", row.target_id).maybeSingle(),
      supabase
        .from("counselor_access")
        .select("status, counselor_id")
        .eq("couple_id", row.target_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.rpc("my_couple"),
    ]);
    const partnerId = pair ? (pair.member_a === member.id ? pair.member_b : pair.member_a) : null;
    if (partnerId) names[partnerId] = title;
    for (const m of chat) if (m.sender_id && !(m.sender_id in names)) names[m.sender_id] = t("chat.counselor");
    const counselorName = ((coupleRows ?? []) as { counselor_name: string | null }[])[0]?.counselor_name;
    if (access?.status === "granted" && access.counselor_id) names[access.counselor_id] = counselorName ?? t("chat.counselor");
  }

  let content;
  if (row.kind === "counsel") {
    const { data: counselRows } = await supabase.rpc("my_counsel");
    const counsel = ((counselRows ?? []) as CounselRow[]).find((c) => c.conversation_id === id);
    if (!counsel) notFound();
    content = (
      <CounselChat
        requestId={counsel.request_id}
        conversationId={id}
        memberId={member.id}
        initial={chat}
        names={names}
        priceXof={counsel.price_xof}
        freeLeft={counsel.free_left}
        screen={screen}
      />
    );
  } else {
    content = (
      <ChatRoom
        conversationId={id}
        memberId={member.id}
        initial={chat}
        closed={ended || row.read_only}
        send={sendMessage}
        report={ended ? undefined : reportConversation}
        markRead={ended ? undefined : markConversationRead}
        partnerReadAt={typeof partnerReadAt === "string" ? partnerReadAt : null}
        names={names}
        showNames={row.kind === "couple"}
        screen={screen}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg pt-[env(safe-area-inset-top)] lg:static lg:z-auto lg:mx-auto lg:h-[calc(100svh-12rem)] lg:min-h-[32rem] lg:max-w-3xl lg:overflow-hidden lg:rounded-md lg:border lg:border-line lg:pt-0">
      {content}
    </div>
  );
}
