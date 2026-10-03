import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { env } from "cloudflare:workers";
import { getSessionUser } from "../../lib/auth";
import { requestOrigin } from "../../lib/request-origin";
import { listAllHistory, listCards } from "../../lib/cards";
import { resolveMirrorTab } from "../../lib/mirror";
import { ensureSchema } from "../../lib/store";
import { SiteAppBar } from "../_components/SiteAppBar";
import { GROWTH_NAMES } from "../../lib/site-nav";
import { MirrorBoard } from "./_components/MirrorBoard";
import type { Card, CardRevision } from "../../lib/cards-core";
import "./mirror.css";
import "./card-editing.css";

export const dynamic = "force-dynamic";
export const viewport = { width: "device-width", initialScale: 1 };
export const metadata = { title: `${GROWTH_NAMES.mirror.label} · 成长`, robots: { index: false, follow: false } };

function EmptyState({ user }: { user: Awaited<ReturnType<typeof getSessionUser>> }) {
  return (
    <div className="mirror-a">
      <SiteAppBar user={user} pathname="/mirror" />
      <div className="mirror-a-masthead-wrap">
        <header className="mirror-a-masthead">
          <p className="page-kicker">成长 · {GROWTH_NAMES.mirror.label}</p>
          <h1 className="page-title">{GROWTH_NAMES.mirror.label}</h1>
        </header>
        <div className="double-rule" />
      </div>
      <main className="mirror-a-main">
        <div className="mirror-a-empty">
          <h2>还没有正本数据</h2>
          <p>
            运行{" "}
            <code>npm run cards:import -- --entries &lt;正本.jsonl&gt; --inbox &lt;收件箱.jsonl&gt;</code>{" "}
            导入后刷新。
          </p>
        </div>
      </main>
    </div>
  );
}

export default async function MirrorPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; view?: string }>;
}) {
  const { tab: requestedTab, view } = await searchParams;

  const requestHeaders = await headers();
  const user = await getSessionUser(
    env,
    new Request(`${requestOrigin(requestHeaders)}/mirror`, {
      headers: {
        cookie: requestHeaders.get("cookie") || "",
        authorization: requestHeaders.get("authorization") || "",
      },
    }),
  );
  if (!user) redirect("/login?next=/mirror");
  if (user.role !== "admin") notFound();

  await ensureSchema(env.DB);

  const [canonicalCards, deletedCards, historyMap] = await Promise.all([
    listCards(env.DB, { kind: "mirror" }),
    listCards(env.DB, { kind: "mirror", deleted: true }),
    listAllHistory(env.DB, "mirror"),
  ]);

  const cards: Card[] = [...canonicalCards, ...deletedCards];
  if (cards.length === 0) return <EmptyState user={user} />;

  // Map 不能直接传给客户端组件，序列化成普通对象。
  const history: Record<string, CardRevision[]> = {};
  for (const [id, revisions] of historyMap.entries()) history[id] = revisions;

  return (
    <div className="mirror-a">
      <SiteAppBar user={user} pathname="/mirror" />
      <MirrorBoard
        initialCards={cards}
        initialHistory={history}
        initialTab={resolveMirrorTab(requestedTab).key}
        initialView={view === "trash" ? "trash" : "deck"}
      />
    </div>
  );
}
