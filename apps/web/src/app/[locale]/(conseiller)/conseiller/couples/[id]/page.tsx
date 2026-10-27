import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { type ChatMessage, ChatRoom } from "@/components/member/ChatRoom";
import { Link } from "@/i18n/navigation";
import { getCounselor } from "@/lib/counselor";
import { createSupabaseServer } from "@/lib/supabase/server";
import { counselorSend } from "../../actions";
import type { CounselorNote, FollowedCouple } from "../../counselor";
import { NoteForm } from "./NoteForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Counselor.couples");
  return { title: t("title") };
}

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Un couple suivi (section 7, 9.6) : conversation du couple (depuis l'arrivée du conseiller, ou
 * tout l'historique si les deux l'ont accepté), où il lit et écrit ; notes privées. Introuvable
 * dès que l'accès est retiré.
 */
export default async function FollowedCouplePage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const counselor = await getCounselor();
  const supabase = await createSupabaseServer();
  if (!counselor || !supabase) notFound();
  const t = await getTranslations("Counselor");
  const tc = await getTranslations("Member.chat");
  const format = await getFormatter();

  const { data: rows } = await supabase.rpc("counselor_couples");
  const couple = ((rows ?? []) as FollowedCouple[]).find((c) => c.couple_id === id);
  if (!couple) notFound();

  const [{ data: messages }, { data: notes }, { data: conversation }] = await Promise.all([
    couple.conversation_id
      ? supabase.from("messages").select("id, sender_id, body, created_at, is_system").eq("conversation_id", couple.conversation_id).order("created_at").limit(500)
      : Promise.resolve({ data: [] as ChatMessage[] }),
    supabase.rpc("counselor_couple_notes", { p_couple: id }),
    couple.conversation_id
      ? supabase.from("conversations").select("read_only, closed_at").eq("id", couple.conversation_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (couple.conversation_id) await supabase.rpc("mark_conversation_read", { p_conversation: couple.conversation_id });

  const names: Record<string, string> = {
    [couple.member_a]: couple.a_first_name,
    [couple.member_b]: couple.b_first_name,
    [counselor.id]: counselor.displayName,
  };
  const closed = !conversation || conversation.read_only || conversation.closed_at !== null;

  return (
    <div className="mx-auto max-w-4xl">
      <p>
        <Link href="/conseiller" className="text-sm text-link underline-offset-4 hover:underline">
          {t("couples.back")}
        </Link>
      </p>
      <header className="mt-6">
        <p className="eyebrow">{t("couples.title")}</p>
        <h1 className="mt-4 font-serif text-4xl">{t("couples.pair", { a: couple.a_first_name, b: couple.b_first_name })}</h1>
        <p className="mt-3 text-sm text-fg-muted">
          {t(`couples.status.${couple.status}`)}
          {couple.blocked && ` · ${t("couples.blocked")}`}
        </p>
        <p className="mt-3 max-w-measure text-sm text-fg-muted">{couple.include_history ? t("couples.history") : t("couples.noHistory")}</p>
      </header>

      {couple.conversation_id ? (
        <ChatRoom
          conversationId={couple.conversation_id}
          memberId={counselor.id}
          initial={(messages ?? []) as ChatMessage[]}
          closed={closed}
          send={counselorSend}
          names={names}
          showNames
        />
      ) : (
        <p className="mt-8 text-fg-muted">{tc("closed")}</p>
      )}

      <section aria-labelledby="notes" className="mt-14">
        <h2 id="notes" className="eyebrow">
          {t("notes.title")}
        </h2>
        <p className="mt-3 max-w-measure text-sm text-fg-muted">{t("notes.private")}</p>
        <NoteForm coupleId={id} />
        <ol className="mt-8 border-t border-line">
          {((notes ?? []) as CounselorNote[]).map((n) => (
            <li key={n.id} className="border-b border-line py-5">
              <p className="text-xs text-fg-muted">
                {format.dateTime(new Date(n.created_at), { dateStyle: "long", timeStyle: "short", timeZone: "Africa/Porto-Novo" })}
              </p>
              <p className="mt-2 whitespace-pre-line">{n.body}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
