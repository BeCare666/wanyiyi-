import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { type ChatMessage, ChatRoom } from "@/components/member/ChatRoom";
import { ProtectedPhoto } from "@/components/ui/ProtectedPhoto";
import { Link } from "@/i18n/navigation";
import { getSessionMember } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { partnerPhotoLink, sendMessage } from "../matchs/actions";
import {
  availableDecisions,
  canInviteCounselor,
  chatOpen,
  chatReadable,
  type CounselorAccess,
  counselorState,
  type CoupleRow,
  isLive,
  milestoneKinds,
} from "./couple";
import { CounselorPanel, CoupleDecisions, DateForm, PhoneShare } from "./CoupleActions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Member.couple");
  return { title: t("title") };
}

type Phone = { i_shared: boolean; can_share: boolean; partner_phone: string | null };
type DateRow = { id: string; date_at: string; declared_by_me: boolean };

/**
 * Espace du couple (sections 6.2-7 et 9.5) : conversation en temps réel, photos de l'autre
 * (filigranées au nom du membre), conseiller, parcours en 5 étapes, rendez-vous déclarés, partage
 * des numéros, décisions et fin. Tout est lu avec le jeton du membre (RLS) ; l'ouverture de
 * l'espace compte comme une activité du couple (question 6).
 */
export default async function CouplePage() {
  const t = await getTranslations("Member");
  const format = await getFormatter();
  const member = await getSessionMember();
  const supabase = await createSupabaseServer();
  if (!member || !supabase) return null;

  const { data: rows, error } = await supabase.rpc("my_couple");
  const couple = ((rows ?? []) as CoupleRow[])[0];

  const header = (
    <header>
      <p className="eyebrow flex items-center gap-4">
        <span aria-hidden="true" className="block h-px w-10 bg-accent" />
        {t("couple.title")}
      </p>
      {couple && <h1 className="mt-6 font-serif text-4xl">{t("couple.with", { name: couple.partner_first_name })}</h1>}
    </header>
  );

  if (error || !couple) {
    return (
      <div className="mx-auto max-w-4xl">
        {header}
        <p role={error ? "alert" : undefined} className="mt-14 border-t border-line pt-8 text-fg-muted">
          {error ? t("errors.unavailable") : t("couple.none")}{" "}
          {!error && (
            <Link href="/espace/matchs" className="text-link underline-offset-4 hover:underline">
              {t("nav.matches")}
            </Link>
          )}
        </p>
      </div>
    );
  }

  const id = couple.couple_id;
  const live = isLive(couple.status);
  if (live) await supabase.rpc("touch_couple", { p_couple: id });

  const [{ data: pair }, { data: conversation }, { data: milestones }, { data: access }, phoneResult, datesResult, priceResult] = await Promise.all([
    supabase.from("couples").select("member_a, member_b, blocked_reason").eq("id", id).maybeSingle(),
    supabase.from("conversations").select("id").eq("couple_id", id).eq("kind", "couple").maybeSingle(),
    supabase.from("couple_milestones").select("kind, reached_at").eq("couple_id", id),
    supabase
      .from("counselor_access")
      .select("id, status, requested_by, accepted_at, price_xof, counselor_id")
      .eq("couple_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    live ? supabase.rpc("my_couple_phone", { p_couple: id }) : Promise.resolve({ data: [] }),
    supabase.rpc("my_couple_dates", { p_couple: id }),
    supabase.rpc("counselor_access_price"),
  ]);
  const partnerId = pair ? (pair.member_a === member.id ? pair.member_b : pair.member_a) : null;
  const lastAccess = (access ?? null) as CounselorAccess | null;
  const [{ data: photos }, { data: messages }, { data: paid }] = await Promise.all([
    live && partnerId
      ? supabase.from("photos").select("id").eq("user_id", partnerId).eq("review_status", "approved").order("position")
      : Promise.resolve({ data: [] as { id: string }[] }),
    conversation && chatReadable(couple.status)
      ? supabase.from("messages").select("id, sender_id, body, created_at, is_system").eq("conversation_id", conversation.id).order("created_at").limit(500)
      : Promise.resolve({ data: [] as ChatMessage[] }),
    lastAccess?.status === "requested" && lastAccess.accepted_at
      ? supabase.rpc("counselor_access_paid", { p_access: lastAccess.id })
      : Promise.resolve({ data: false }),
  ]);

  // Conversation affichée : elle ne compte plus dans les messages non lus du tableau de bord
  if (conversation && chatReadable(couple.status)) await supabase.rpc("mark_conversation_read", { p_conversation: conversation.id });

  const phone = ((phoneResult.data ?? []) as Phone[])[0] ?? null;
  const dates = (datesResult.data ?? []) as DateRow[];
  const state = counselorState(lastAccess, member.id, paid === true);
  const amount = (xof: number) => format.number(xof, { style: "currency", currency: "XOF", maximumFractionDigits: 0 });
  const accessPrice = lastAccess?.price_xof ?? null;
  const currentPrice = typeof priceResult.data === "number" ? priceResult.data : null;
  const shownPrice = state === "none" ? (currentPrice && currentPrice > 0 ? amount(currentPrice) : null) : accessPrice ? amount(accessPrice) : null;
  const reached = new Map(((milestones ?? []) as { kind: string; reached_at: string | null }[]).map((m) => [m.kind, m.reached_at]));
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "long", timeStyle: "short", timeZone: "Africa/Porto-Novo" });
  // Prénoms dans la conversation : l'autre membre, et tout conseiller (actuel par son nom, ancien sous « Conseiller »)
  const names: Record<string, string> = { [member.id]: member.firstName ?? t("chat.me"), ...(partnerId ? { [partnerId]: couple.partner_first_name } : {}) };
  for (const m of (messages ?? []) as ChatMessage[]) {
    if (m.sender_id && !(m.sender_id in names)) names[m.sender_id] = t("chat.counselor");
  }
  if (lastAccess?.status === "granted" && lastAccess.counselor_id) names[lastAccess.counselor_id] = couple.counselor_name ?? t("chat.counselor");

  return (
    <div className="mx-auto max-w-4xl">
      {header}
      <p className="mt-6 max-w-measure text-lg text-fg-muted">{t(`couple.status.${couple.status}`)}</p>
      {couple.blocked && (
        <p role="status" className="mt-6 max-w-measure border-l border-accent pl-5">
          {t("couple.blocked")}
          {pair?.blocked_reason && <span className="mt-2 block text-sm text-fg-muted">{pair.blocked_reason}</span>}
        </p>
      )}
      {couple.counselor_name && live && <p className="mt-4 text-sm text-fg-muted">{t("couple.counselorPresent", { name: couple.counselor_name })}</p>}

      {chatReadable(couple.status) && conversation && (
        <ChatRoom
          conversationId={conversation.id}
          memberId={member.id}
          initial={(messages ?? []) as ChatMessage[]}
          closed={!chatOpen(couple)}
          send={sendMessage}
          names={names}
          showNames
        />
      )}

      {live && (photos ?? []).length > 0 && (
        <section aria-labelledby="photos" className="mt-14">
          <h2 id="photos" className="eyebrow">
            {t("discoveries.photos")}
          </h2>
          <ul className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {(photos ?? []).map((p, i) => (
              <li key={p.id}>
                <ProtectedPhoto load={partnerPhotoLink.bind(null, p.id)} alt={t("discoveries.photoAlt", { name: couple.partner_first_name, rank: i + 1 })} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {(live || couple.status === "union_celebrated") && (
        <section aria-labelledby="parcours" className="mt-14">
          <h2 id="parcours" className="eyebrow">
            {t("couple.journey.title")}
          </h2>
          <ol className="mt-4 border-t border-line">
            {milestoneKinds.map((kind, i) => {
              const at = reached.get(kind);
              return (
                <li key={kind} className="grid gap-2 border-b border-line py-5 md:grid-cols-12 md:items-baseline md:gap-8">
                  <p className="md:col-span-7">
                    <span className="mr-3 text-sm text-fg-muted">{i + 1}.</span>
                    {t(`couple.journey.${kind}`)}
                  </p>
                  <p className="text-sm text-fg-muted md:col-span-5 md:text-right">
                    {at ? t("couple.journey.reached", { date: format.dateTime(new Date(at), { dateStyle: "long" }) }) : t("couple.journey.notYet")}
                  </p>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {live && (
        <section aria-labelledby="conseiller" className="mt-14">
          <h2 id="conseiller" className="eyebrow">
            {t("couple.counselor.title")}
          </h2>
          <CounselorPanel
            coupleId={id}
            accessId={state === "none" ? null : (lastAccess?.id ?? null)}
            state={state}
            canInvite={canInviteCounselor(couple, state)}
            price={shownPrice}
          />
        </section>
      )}

      {(live || dates.length > 0) && (
        <section aria-labelledby="rendez-vous" className="mt-14">
          <h2 id="rendez-vous" className="eyebrow">
            {t("couple.dates.title")}
          </h2>
          <p className="mt-3 max-w-measure text-sm text-fg-muted">{t("couple.dates.help")}</p>
          {couple.status === "active" && <DateForm coupleId={id} />}
          {dates.length > 0 && (
            <ul className="mt-6 border-t border-line">
              {dates.map((d) => (
                <li key={d.id} className="flex flex-wrap justify-between gap-4 border-b border-line py-4">
                  <span>{when(d.date_at)}</span>
                  <span className="text-sm text-fg-muted">{d.declared_by_me ? t("couple.dates.byMe") : t("couple.dates.byPartner", { name: couple.partner_first_name })}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {live && phone && (
        <section aria-labelledby="numeros" className="mt-14">
          <h2 id="numeros" className="eyebrow">
            {t("couple.phone.title")}
          </h2>
          {couple.blocked ? (
            <p className="mt-4 text-sm text-fg-muted">{t("couple.phone.blocked")}</p>
          ) : (
            <PhoneShare
              coupleId={id}
              iShared={phone.i_shared}
              canShare={phone.can_share}
              partnerPhone={phone.partner_phone}
              partnerName={couple.partner_first_name}
            />
          )}
        </section>
      )}

      {(live || couple.status === "union_celebrated") && (
        <section aria-labelledby="decisions" className="mt-14">
          <h2 id="decisions" className="eyebrow">
            {t("couple.decisions.title")}
          </h2>
          <div className="mt-4">
            <CoupleDecisions coupleId={id} decisions={availableDecisions(couple)} myRequests={couple.my_requests} canLeave={live} />
          </div>
        </section>
      )}
    </div>
  );
}
