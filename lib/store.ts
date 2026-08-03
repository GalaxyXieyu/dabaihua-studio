import { discoverFeedLinks, feedTitle, isFeedDocument, parseFeed, type FeedEntry } from "./feed";
import { fetchPublicText, publicHttpUrl } from "./safe-fetch";
import { extractArticle, htmlToMarkdown, readHtmlMeta } from "./article";
import { inferSourceCategory, isSourceCategory, type SourceCategory } from "./source-category";
import { readXArticles, readXPost, readXProfile, xPostAddress, xProfileAddress } from "./x";

export type AppEnv = { DB: D1Database; AI?: { run: (model: string, input: unknown) => Promise<unknown> } };
const now = () => new Date().toISOString();
const day = () => new Date().toISOString().slice(0, 10);
const SCHEMA_VERSION = "2026-08-03.2";
const schemaReady = new WeakMap<object, Promise<void>>();

async function initializeSchema(db: D1Database) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL, account_normalized TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, password_iterations INTEGER NOT NULL DEFAULT 100000, nickname TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '', avatar_key TEXT, role TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS auth_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, attempt_key TEXT NOT NULL, action TEXT NOT NULL, succeeded INTEGER NOT NULL DEFAULT 0, attempted_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS api_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, last_used_at TEXT, FOREIGN KEY(user_id) REFERENCES users(id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS eval_profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, version INTEGER NOT NULL, content TEXT NOT NULL, note TEXT, is_active INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS item_evaluations (item_id INTEGER PRIMARY KEY, heat INTEGER NOT NULL DEFAULT 0, match_score INTEGER NOT NULL DEFAULT 0, feasibility INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, verdict TEXT NOT NULL, hkr TEXT, model TEXT, created_at TEXT NOT NULL, FOREIGN KEY(item_id) REFERENCES items(id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS topics (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, angle TEXT NOT NULL, reason TEXT, platform TEXT, content_type TEXT, heat INTEGER, match_score INTEGER, feasibility INTEGER, total INTEGER NOT NULL DEFAULT 0, hkr TEXT, status TEXT NOT NULL DEFAULT 'candidate', item_ids TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS topics_status_idx ON topics(status, total DESC, id DESC)"),
    db.prepare("CREATE TABLE IF NOT EXISTS sources (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'rss', category TEXT, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1, last_synced_at TEXT, last_error TEXT, avatar_url TEXT, contributor_user_id INTEGER, sync_interval_minutes INTEGER, created_at TEXT NOT NULL, FOREIGN KEY(contributor_user_id) REFERENCES users(id))"),
    db.prepare("UPDATE sources SET kind = 'x-tweet' WHERE url LIKE 'x-tweets://%'"),
    db.prepare("UPDATE sources SET url = 'x-tweets://karpathy' WHERE url = 'x-tweets://Andrej Karpathy'"),
    db.prepare("UPDATE sources SET url = 'x-tweets://sama' WHERE url = 'x-tweets://Sam Altman'"),
    db.prepare("UPDATE sources SET url = 'x-tweets://simonw' WHERE url = 'x-tweets://Simon Willison'"),
    db.prepare("CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER, kind TEXT NOT NULL, title TEXT NOT NULL, original_excerpt TEXT, content_markdown TEXT, author TEXT, translated_title TEXT, translated_excerpt TEXT, url TEXT NOT NULL UNIQUE, published_at TEXT, language TEXT, topic TEXT, status TEXT NOT NULL DEFAULT 'pending', is_read INTEGER NOT NULL DEFAULT 0, is_saved INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS sync_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, item_count INTEGER NOT NULL DEFAULT 0, error TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS ideas (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL UNIQUE, headline TEXT NOT NULL, angle TEXT NOT NULL, source_item_ids TEXT NOT NULL, created_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS itches (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, body TEXT NOT NULL, normalized_body TEXT NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'open', felt_count INTEGER NOT NULL DEFAULT 1, first_felt_at TEXT NOT NULL, last_felt_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS itch_events (id INTEGER PRIMARY KEY AUTOINCREMENT, itch_id INTEGER NOT NULL, user_id INTEGER NOT NULL, type TEXT NOT NULL, body TEXT, metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, FOREIGN KEY(itch_id) REFERENCES itches(id), FOREIGN KEY(user_id) REFERENCES users(id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS itch_links (id INTEGER PRIMARY KEY AUTOINCREMENT, itch_id INTEGER NOT NULL, user_id INTEGER NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, relation TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL, FOREIGN KEY(itch_id) REFERENCES itches(id), FOREIGN KEY(user_id) REFERENCES users(id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS explorations (id INTEGER PRIMARY KEY AUTOINCREMENT, itch_id INTEGER NOT NULL, user_id INTEGER NOT NULL, round INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', trigger_context TEXT, core_conflict TEXT, personal_stake TEXT, desired_change TEXT, question_tree TEXT NOT NULL DEFAULT '[]', material_map TEXT NOT NULL DEFAULT '[]', counter_evidence TEXT NOT NULL DEFAULT '[]', evidence_gaps TEXT NOT NULL DEFAULT '[]', note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(itch_id) REFERENCES itches(id), FOREIGN KEY(user_id) REFERENCES users(id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS directions (id INTEGER PRIMARY KEY AUTOINCREMENT, itch_id INTEGER NOT NULL, exploration_id INTEGER, user_id INTEGER NOT NULL, claim TEXT NOT NULL, audience TEXT, tension TEXT, personal_connection TEXT, evidence_for TEXT NOT NULL DEFAULT '[]', evidence_against TEXT NOT NULL DEFAULT '[]', evidence_gaps TEXT NOT NULL DEFAULT '[]', confidence TEXT NOT NULL DEFAULT 'low', status TEXT NOT NULL DEFAULT 'candidate', confirmation_note TEXT, confirmed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(itch_id) REFERENCES itches(id), FOREIGN KEY(exploration_id) REFERENCES explorations(id), FOREIGN KEY(user_id) REFERENCES users(id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS subscription_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, query TEXT NOT NULL UNIQUE, kind TEXT NOT NULL DEFAULT 'unknown', category TEXT, status TEXT NOT NULL DEFAULT 'pending', stage TEXT NOT NULL DEFAULT 'queued', result_name TEXT, item_count INTEGER NOT NULL DEFAULT 0, requester_user_id INTEGER, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT, FOREIGN KEY(requester_user_id) REFERENCES users(id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS user_item_states (user_id INTEGER NOT NULL, item_id INTEGER NOT NULL, is_read INTEGER NOT NULL DEFAULT 0, read_at TEXT, is_saved INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY(user_id, item_id), FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(item_id) REFERENCES items(id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS daily_reading_activity (user_id INTEGER NOT NULL, item_id INTEGER NOT NULL, day TEXT NOT NULL, active_seconds INTEGER NOT NULL DEFAULT 0, last_heartbeat_at TEXT NOT NULL, counted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id, item_id, day), FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(item_id) REFERENCES items(id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS user_source_follows (user_id INTEGER NOT NULL, source_id INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id, source_id), FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(source_id) REFERENCES sources(id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS annotations (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, user_id INTEGER NOT NULL, quote TEXT NOT NULL, body TEXT NOT NULL, block_index INTEGER NOT NULL, start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(item_id) REFERENCES items(id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS annotation_replies (id INTEGER PRIMARY KEY AUTOINCREMENT, annotation_id INTEGER NOT NULL, user_id INTEGER NOT NULL, reply_to_user_id INTEGER, body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(annotation_id) REFERENCES annotations(id), FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(reply_to_user_id) REFERENCES users(id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS profile_likes (user_id INTEGER NOT NULL, profile_user_id INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id, profile_user_id), FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(profile_user_id) REFERENCES users(id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS profile_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, profile_user_id INTEGER NOT NULL, author_user_id INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(profile_user_id) REFERENCES users(id), FOREIGN KEY(author_user_id) REFERENCES users(id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, actor_user_id INTEGER NOT NULL, type TEXT NOT NULL, annotation_id INTEGER, profile_message_id INTEGER, is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(actor_user_id) REFERENCES users(id), FOREIGN KEY(annotation_id) REFERENCES annotations(id), FOREIGN KEY(profile_message_id) REFERENCES profile_messages(id))"),
    db.prepare("CREATE INDEX IF NOT EXISTS items_created_idx ON items(created_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS items_source_idx ON items(source_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS auth_attempts_key_idx ON auth_attempts(attempt_key, action, attempted_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS reading_day_idx ON daily_reading_activity(day, user_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS user_source_follows_source_idx ON user_source_follows(source_id, user_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS annotations_item_idx ON annotations(item_id, block_index, start_offset)"),
    db.prepare("CREATE INDEX IF NOT EXISTS annotations_user_idx ON annotations(user_id, created_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS annotation_replies_annotation_idx ON annotation_replies(annotation_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS profile_likes_profile_idx ON profile_likes(profile_user_id, created_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS profile_messages_profile_idx ON profile_messages(profile_user_id, created_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, is_read, created_at DESC)"),
    db.prepare("CREATE TABLE IF NOT EXISTS content_strategies (id INTEGER PRIMARY KEY AUTOINCREMENT, version INTEGER NOT NULL, content TEXT NOT NULL, note TEXT, is_active INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS retrospectives (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, title TEXT NOT NULL, problem TEXT NOT NULL, result TEXT NOT NULL, lesson TEXT NOT NULL, related_series TEXT, related_topic_ids TEXT NOT NULL DEFAULT '[]', version INTEGER NOT NULL DEFAULT 1, is_active INTEGER NOT NULL DEFAULT 1, supersedes_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS content_strategies_active_idx ON content_strategies(is_active, version DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS retrospectives_active_idx ON retrospectives(is_active, date DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS retrospectives_title_idx ON retrospectives(title, version DESC)"),
  ]);
  const legacyFollowCleanupKey = "legacy_source_follow_seed_cleanup_v1";
  const legacyFollowCleanup = await db.prepare("SELECT value FROM app_meta WHERE key = ?").bind(legacyFollowCleanupKey).first<{ value: string }>();
  if (!legacyFollowCleanup) {
    // Older builds assigned every existing source to every existing account in one batch.
    // Only remove those non-admin batch rows; individually-created follow records remain intact.
    await db.prepare("DELETE FROM user_source_follows WHERE user_id IN (SELECT id FROM users WHERE role <> 'admin') AND EXISTS (SELECT 1 FROM user_source_follows seeded WHERE seeded.user_id = user_source_follows.user_id AND seeded.created_at = user_source_follows.created_at GROUP BY seeded.user_id, seeded.created_at HAVING COUNT(*) > 1)").run();
    await db.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES (?, 'complete', ?)").bind(legacyFollowCleanupKey, now()).run();
  }
  const sourceColumns = await db.prepare("PRAGMA table_info(sources)").all<{ name: string }>();
  if (!sourceColumns.results.some((column) => column.name === "kind")) {
    await db.prepare("ALTER TABLE sources ADD COLUMN kind TEXT NOT NULL DEFAULT 'rss'").run();
  }
  if (!sourceColumns.results.some((column) => column.name === "category")) await db.prepare("ALTER TABLE sources ADD COLUMN category TEXT").run();
  if (!sourceColumns.results.some((column) => column.name === "avatar_url")) await db.prepare("ALTER TABLE sources ADD COLUMN avatar_url TEXT").run();
  if (!sourceColumns.results.some((column) => column.name === "contributor_user_id")) await db.prepare("ALTER TABLE sources ADD COLUMN contributor_user_id INTEGER REFERENCES users(id)").run();
  if (!sourceColumns.results.some((column) => column.name === "sync_interval_minutes")) await db.prepare("ALTER TABLE sources ADD COLUMN sync_interval_minutes INTEGER").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS sources_contributor_idx ON sources(contributor_user_id, created_at)").run();
  const itemColumns = await db.prepare("PRAGMA table_info(items)").all<{ name: string }>();
  if (!itemColumns.results.some((column) => column.name === "content_markdown")) await db.prepare("ALTER TABLE items ADD COLUMN content_markdown TEXT").run();
  if (!itemColumns.results.some((column) => column.name === "author")) await db.prepare("ALTER TABLE items ADD COLUMN author TEXT").run();
  const requestColumns = await db.prepare("PRAGMA table_info(subscription_requests)").all<{ name: string }>();
  if (!requestColumns.results.some((column) => column.name === "kind")) await db.prepare("ALTER TABLE subscription_requests ADD COLUMN kind TEXT NOT NULL DEFAULT 'unknown'").run();
  if (!requestColumns.results.some((column) => column.name === "category")) await db.prepare("ALTER TABLE subscription_requests ADD COLUMN category TEXT").run();
  if (!requestColumns.results.some((column) => column.name === "last_error")) await db.prepare("ALTER TABLE subscription_requests ADD COLUMN last_error TEXT").run();
  if (!requestColumns.results.some((column) => column.name === "updated_at")) await db.prepare("ALTER TABLE subscription_requests ADD COLUMN updated_at TEXT").run();
  if (!requestColumns.results.some((column) => column.name === "stage")) await db.prepare("ALTER TABLE subscription_requests ADD COLUMN stage TEXT NOT NULL DEFAULT 'queued'").run();
  if (!requestColumns.results.some((column) => column.name === "result_name")) await db.prepare("ALTER TABLE subscription_requests ADD COLUMN result_name TEXT").run();
  if (!requestColumns.results.some((column) => column.name === "item_count")) await db.prepare("ALTER TABLE subscription_requests ADD COLUMN item_count INTEGER NOT NULL DEFAULT 0").run();
  if (!requestColumns.results.some((column) => column.name === "requester_user_id")) await db.prepare("ALTER TABLE subscription_requests ADD COLUMN requester_user_id INTEGER REFERENCES users(id)").run();
  const itchColumns = await db.prepare("PRAGMA table_info(itches)").all<{ name: string }>();
  const itchExisting = new Set(itchColumns.results.map((column) => column.name));
  const itchNewColumns: Array<[string, string]> = [
    ["normalized_body", "TEXT"],
    ["felt_count", "INTEGER NOT NULL DEFAULT 1"],
    ["first_felt_at", "TEXT"],
    ["last_felt_at", "TEXT"],
  ];
  for (const [name, type] of itchNewColumns) {
    if (!itchExisting.has(name)) await db.prepare(`ALTER TABLE itches ADD COLUMN ${name} ${type}`).run();
  }
  await db.batch([
    db.prepare("UPDATE itches SET normalized_body = lower(trim(body)) WHERE normalized_body IS NULL OR normalized_body = ''"),
    db.prepare("UPDATE itches SET felt_count = COALESCE(felt_count, 1), first_felt_at = COALESCE(first_felt_at, created_at), last_felt_at = COALESCE(last_felt_at, updated_at, created_at)"),
    db.prepare("UPDATE itches SET status = 'open' WHERE status IN ('researching', 'triggered')"),
    db.prepare("UPDATE itches SET status = 'resolved' WHERE status = 'killed'"),
    db.prepare("DROP INDEX IF EXISTS itches_user_status_idx"),
  ]);
  await db.batch([
    db.prepare("CREATE INDEX IF NOT EXISTS itches_user_status_idx ON itches(user_id, status, last_felt_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS itches_user_normalized_idx ON itches(user_id, normalized_body)"),
    db.prepare("CREATE INDEX IF NOT EXISTS itch_events_itch_created_idx ON itch_events(itch_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS itch_links_itch_idx ON itch_links(itch_id, created_at)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS itch_links_unique_idx ON itch_links(itch_id, target_type, target_id, relation)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS explorations_itch_round_idx ON explorations(itch_id, user_id, round)"),
    db.prepare("CREATE INDEX IF NOT EXISTS explorations_user_updated_idx ON explorations(user_id, updated_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS directions_itch_status_idx ON directions(itch_id, user_id, status, updated_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS directions_exploration_idx ON directions(exploration_id)"),
  ]);
  // topics 表扩展列（幂等 ALTER）
  const topicColumns = await db.prepare("PRAGMA table_info(topics)").all<{ name: string }>();
  const topicExisting = new Set(topicColumns.results.map((c) => c.name));
  const topicNewCols: Array<[string, string]> = [
    ["series", "TEXT"],
    ["series_order", "INTEGER"],
    ["scheduled_date", "TEXT"],
    ["published_date", "TEXT"],
    ["published_url", "TEXT"],
    ["notes", "TEXT"],
    ["platform_detail", "TEXT"],
    ["metrics", "TEXT"],
  ];
  for (const [name, type] of topicNewCols) {
    if (!topicExisting.has(name)) {
      await db.prepare(`ALTER TABLE topics ADD COLUMN ${name} ${type}`).run();
    }
  }
  // topics 扩展列的索引（必须在 ALTER 之后建）
  await db.batch([
    db.prepare("CREATE INDEX IF NOT EXISTS topics_series_idx ON topics(series, series_order)"),
    db.prepare("CREATE INDEX IF NOT EXISTS topics_scheduled_idx ON topics(scheduled_date) WHERE scheduled_date IS NOT NULL"),
  ]);

  // 种子复盘数据（首次启动）
  await seedRetrospectives(db);

  await backfillSourceCategories(db);
  await db.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES ('schema_version', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(SCHEMA_VERSION, now()).run();
}

async function ensureCurrentSchema(db: D1Database) {
  try {
    const row = await db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").first<{ value: string }>();
    if (row?.value === SCHEMA_VERSION) return;
  } catch {
    // Existing databases created before app_meta need one full compatibility pass.
  }
  await initializeSchema(db);
}

export async function ensureSchema(db: D1Database) {
  const key = db as object;
  const ready = schemaReady.get(key);
  if (ready) return ready;
  const pending = ensureCurrentSchema(db).catch((error) => {
    schemaReady.delete(key);
    throw error;
  });
  schemaReady.set(key, pending);
  return pending;
}

async function seedRetrospectives(db: D1Database) {
  const count = await db.prepare("SELECT COUNT(*) AS c FROM retrospectives").first<{ c: number }>();
  if (Number(count?.c || 0) > 0) return;
  const ts = now();
  await db.prepare(
    `INSERT INTO retrospectives (date, title, problem, result, lesson, related_series, related_topic_ids, version, is_active, created_at, updated_at)
     VALUES ('2026-07-10', 'LangGraph 系列事故',
       '7月10日单天发了4篇，互相争夺推荐位；每篇文章末尾没有导航到其他篇的链接；系列没有大纲导读作为入口',
       '系列阅读量悬崖式下跌（109→43→38→26→24→16→10）',
       '系列连载 ≠ 批量发布。合集效果靠的是交叉引流，不是堆数量。后续：单日≤1篇 + 第0篇大纲导读 + 每篇footer导航',
       'LangGraph实战', '[]', 1, 1, ?, ?)`,
  ).bind(ts, ts).run();
}

async function backfillSourceCategories(db: D1Database) {
  const sources = await db.prepare("SELECT id, name FROM sources WHERE category IS NULL OR category = '' ORDER BY id").all<{ id: number; name: string }>();
  for (const source of sources.results) {
    const items = await db.prepare("SELECT COALESCE(translated_title, title) AS title FROM items WHERE source_id = ? ORDER BY id DESC LIMIT 20")
      .bind(source.id).all<{ title: string }>();
    const category = inferSourceCategory(source.name, items.results.map((item) => item.title));
    await db.prepare("UPDATE sources SET category = ? WHERE id = ? AND (category IS NULL OR category = '')").bind(category, source.id).run();
  }
}

export async function dashboard(env: AppEnv, userId: number | null = null) {
  await ensureSchema(env.DB);
  const [sourceRows, itemRows, totalRow, ideaRow, importRows] = await Promise.all([
    env.DB.prepare("SELECT s.id, s.kind, s.category, s.name, s.url, s.enabled, s.last_synced_at AS lastSyncedAt, s.last_error AS lastError, s.avatar_url AS avatarUrl, s.sync_interval_minutes AS syncIntervalMinutes, s.contributor_user_id AS contributorUserId, COALESCE(u.nickname, '站点收录') AS contributorNickname, CASE WHEN s.contributor_user_id = ? THEN 1 ELSE 0 END AS canManage, CASE WHEN usf.user_id IS NULL THEN 0 ELSE 1 END AS isFollowed, (SELECT COUNT(*) FROM items i WHERE i.source_id = s.id) AS itemCount FROM sources s LEFT JOIN users u ON u.id = s.contributor_user_id LEFT JOIN user_source_follows usf ON usf.source_id = s.id AND usf.user_id = ? ORDER BY s.created_at DESC").bind(userId || -1, userId || -1).all(),
    env.DB.prepare("SELECT i.id, i.source_id AS sourceId, i.kind, i.title, i.author, i.original_excerpt AS originalExcerpt, i.translated_title AS translatedTitle, i.translated_excerpt AS translatedExcerpt, i.url, i.published_at AS publishedAt, i.language, i.topic, i.status, COALESCE(uis.is_read, 0) AS isRead, COALESCE(uis.is_saved, 0) AS isSaved, s.name AS sourceName FROM items i LEFT JOIN sources s ON s.id = i.source_id LEFT JOIN user_item_states uis ON uis.item_id = i.id AND uis.user_id = ? ORDER BY CASE WHEN i.published_at IS NULL OR i.published_at = '' THEN 1 ELSE 0 END, i.published_at DESC, i.id DESC LIMIT 500").bind(userId || -1).all(),
    env.DB.prepare("SELECT COUNT(*) AS totalItems FROM items").first<{ totalItems: number }>(),
    env.DB.prepare("SELECT id, day, headline, angle, source_item_ids AS sourceItemIds FROM ideas WHERE day = ?").bind(day()).first(),
    userId ? env.DB.prepare("SELECT id, query, status, stage, result_name AS resultName, item_count AS itemCount, last_error AS lastError, created_at AS createdAt, updated_at AS updatedAt FROM subscription_requests WHERE requester_user_id = ? AND kind = 'wechat' AND (status = 'pending' OR julianday(COALESCE(updated_at, created_at)) >= julianday('now', '-10 minutes')) ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 4").bind(userId).all() : Promise.resolve({ results: [] }),
  ]);
  return { sources: sourceRows.results, items: itemRows.results, totalItems: Number(totalRow?.totalItems || 0), idea: ideaRow, imports: importRows.results };
}

const FEED_ACCEPT = "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8";

async function resolveFeed(value: string) {
  const first = await fetchPublicText(value, { accept: FEED_ACCEPT, maxBytes: 1_500_000 });
  if (!first.response.ok) throw new Error(`这个地址返回 ${first.response.status}`);
  if (isFeedDocument(first.text)) return { url: first.url, title: feedTitle(first.text), entries: parseFeed(first.text) };

  const pageUrl = first.url;
  const page = new URL(pageUrl);
  const candidates = [
    ...discoverFeedLinks(first.text, pageUrl),
    new URL("./feed/", pageUrl).toString(),
    new URL("/feed/", page).toString(),
    new URL("/feed.xml", page).toString(),
    new URL("/rss.xml", page).toString(),
    new URL("/atom.xml", page).toString(),
  ].filter((candidate, index, all) => candidate !== pageUrl && all.indexOf(candidate) === index).slice(0, 8);

  for (const candidate of candidates) {
    try {
      const fetched = await fetchPublicText(candidate, { accept: FEED_ACCEPT, maxBytes: 1_500_000 });
      if (fetched.response.ok && isFeedDocument(fetched.text)) return { url: fetched.url, title: feedTitle(fetched.text), entries: parseFeed(fetched.text) };
    } catch {
      // A site often advertises stale fallback paths; keep trying its other candidates.
    }
  }
  throw new Error("这个网站没有找到可用的 RSS 或 Atom 订阅源");
}

async function saveFeedEntries(env: AppEnv, sourceId: number, entries: FeedEntry[], kind: "rss" | "link" | "x_article" = "rss") {
  let added = 0;
  for (const entry of entries) {
    const inserted = await env.DB.prepare("INSERT OR IGNORE INTO items (source_id, kind, title, original_excerpt, content_markdown, author, url, published_at, language, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'needs_ai', ?)")
      .bind(sourceId, kind, entry.title, entry.excerpt, entry.contentMarkdown, entry.author, entry.url, entry.publishedAt, /[\u4e00-\u9fff]/.test(entry.title) ? "zh" : "unknown", now()).run();
    if (inserted.meta.changes) added += 1;
    else if (kind === "link") await env.DB.prepare("UPDATE items SET source_id = ? WHERE url = ? AND source_id IS NULL").bind(sourceId, entry.url).run();
    else if (kind === "x_article") await env.DB.prepare("UPDATE items SET source_id = ?, kind = 'x_article', title = ?, original_excerpt = ?, content_markdown = COALESCE(?, content_markdown), author = COALESCE(?, author), published_at = COALESCE(?, published_at) WHERE url = ?")
      .bind(sourceId, entry.title, entry.excerpt, entry.contentMarkdown, entry.author, entry.publishedAt, entry.url).run();
    else if (kind === "rss") await env.DB.prepare("UPDATE items SET source_id = ?, title = ?, original_excerpt = COALESCE(?, original_excerpt), content_markdown = COALESCE(?, content_markdown), author = COALESCE(?, author), published_at = COALESCE(?, published_at) WHERE url = ?")
      .bind(sourceId, entry.title, entry.excerpt, entry.contentMarkdown, entry.author, entry.publishedAt, entry.url).run();
  }
  return added;
}

export async function addSource(env: AppEnv, name: string, url: string, contributorUserId: number | null = null, category: SourceCategory = "business") {
  await ensureSchema(env.DB);
  const resolved = await resolveFeed(publicHttpUrl(url.trim()).toString());
  const cleanName = resolved.title?.trim() || name.trim() || new URL(resolved.url).hostname.replace(/^www\./, "");
  const avatarUrl = new URL("/favicon.ico", resolved.url).toString();
  if (cleanName.length > 80) throw new Error("信息源名称最多 80 个字");
  const existing = await env.DB.prepare("SELECT id FROM sources WHERE url = ?").bind(resolved.url).first<{ id: number }>();
  await env.DB.prepare("INSERT INTO sources (kind, category, name, url, enabled, last_synced_at, last_error, avatar_url, contributor_user_id, created_at) VALUES ('rss', ?, ?, ?, 1, ?, NULL, ?, ?, ?) ON CONFLICT(url) DO UPDATE SET kind = 'rss', name = excluded.name, enabled = 1, last_error = NULL, avatar_url = excluded.avatar_url")
    .bind(category, cleanName, resolved.url, now(), avatarUrl, contributorUserId, now()).run();
  const source = await env.DB.prepare("SELECT id, contributor_user_id AS contributorUserId FROM sources WHERE url = ?").bind(resolved.url).first<{ id: number; contributorUserId: number | null }>();
  if (!source) throw new Error("订阅源创建失败");
  const sync = await env.DB.prepare("INSERT INTO sync_runs (source_id, started_at) VALUES (?, ?)").bind(source.id, now()).run();
  const added = await saveFeedEntries(env, source.id, resolved.entries);
  await env.DB.batch([
    env.DB.prepare("UPDATE sources SET last_synced_at = ?, last_error = NULL WHERE id = ?").bind(now(), source.id),
    env.DB.prepare("UPDATE sync_runs SET finished_at = ?, item_count = ? WHERE id = ?").bind(now(), added, Number(sync.meta.last_row_id)),
  ]);
  return { id: source.id, name: cleanName, url: resolved.url, added, created: !existing, contributorUserId: source.contributorUserId };
}

function normalizeSubscriptionInput(value: string) {
  const clean = value.trim();
  if (!clean) throw new Error("请粘贴公众号文章、X 作者主页或博客地址");
  if (/^https?:\/\//i.test(clean)) return publicHttpUrl(clean).toString();
  if (/^(?:www\.)?[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:\/.*)?$/.test(clean)) return publicHttpUrl(`https://${clean}`).toString();
  throw new Error("请粘贴完整的网址");
}

function xSourceUsername(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "x:" && /^[A-Za-z0-9_]{1,15}$/.test(parsed.hostname) ? parsed.hostname : "";
  } catch {
    return "";
  }
}

async function addXSource(env: AppEnv, value: string, contributorUserId: number | null = null, category: SourceCategory = "business") {
  const address = xProfileAddress(value);
  if (!address) throw new Error("请粘贴 X 作者主页，而不是首页或搜索页面");
  const profile = await readXProfile(address.url);
  const sourceUrl = `x://${profile.username.toLowerCase()}`;
  const existing = await env.DB.prepare("SELECT id FROM sources WHERE url = ?").bind(sourceUrl).first<{ id: number }>();
  await env.DB.prepare("INSERT INTO sources (kind, category, name, url, enabled, last_error, avatar_url, contributor_user_id, created_at) VALUES ('x', ?, ?, ?, 1, NULL, ?, ?, ?) ON CONFLICT(url) DO UPDATE SET kind = 'x', name = excluded.name, enabled = 1, avatar_url = excluded.avatar_url")
    .bind(category, profile.name, sourceUrl, profile.avatarUrl || null, contributorUserId, now()).run();
  const source = await env.DB.prepare("SELECT id FROM sources WHERE url = ?").bind(sourceUrl).first<{ id: number }>();
  if (!source) throw new Error("X 订阅源创建失败");
  if (contributorUserId) await setSourceFollowing(env, source.id, contributorUserId, true);

  try {
    const added = await syncSource(env, source.id);
    const after = await env.DB.prepare("SELECT kind FROM sources WHERE id = ?").bind(source.id).first<{ kind: string }>();
    const converted = !after || after.kind === "x-tweet";
    return { kind: "x" as const, id: source.id, name: profile.name, added,
      created: !existing,
      warning: converted ? "该账号没有公开长文，已按「推文模式」收录：由采集端定时抓取其日常推文" : "" };
  } catch (error) {
    if (!existing) await deleteSource(env, source.id);
    throw error;
  }
}

export async function addSubscription(env: AppEnv, input: string, contributorUserId: number, categoryInput: unknown) {
  await ensureSchema(env.DB);
  if (!isSourceCategory(categoryInput)) throw new Error("请选择订阅源分类");
  const category = categoryInput;
  const value = normalizeSubscriptionInput(input);
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  if (host === "mp.weixin.qq.com") {
    const requestId = await requestSubscription(env, value, "wechat", contributorUserId, category);
    return { kind: "wechat" as const, pending: true, requestId, name: "微信公众号", added: 0 };
  }
  if (host === "x.com" || host === "twitter.com") {
    if (xPostAddress(value)) {
      const captured = await captureLink(env, value);
      return { kind: "article" as const, ...captured, added: 1 };
    }
    return addXSource(env, value, contributorUserId, category);
  }

  const source = await addSource(env, "", value, contributorUserId, category);
  await setSourceFollowing(env, source.id, contributorUserId, true);
  return { kind: "rss" as const, ...source, warning: "" };
}

export async function setSourceFollowing(env: AppEnv, id: number, userId: number, following: boolean) {
  await ensureSchema(env.DB);
  const source = await env.DB.prepare("SELECT id FROM sources WHERE id = ?").bind(id).first();
  if (!source) throw new Error("这个来源不存在");
  if (following) {
    await env.DB.prepare("INSERT OR IGNORE INTO user_source_follows (user_id, source_id, created_at) VALUES (?, ?, ?)")
      .bind(userId, id, now()).run();
  } else {
    await env.DB.prepare("DELETE FROM user_source_follows WHERE user_id = ? AND source_id = ?").bind(userId, id).run();
  }
}

export async function setSourceEnabled(env: AppEnv, id: number, enabled: boolean) {
  await ensureSchema(env.DB);
  await env.DB.prepare("UPDATE sources SET enabled = ? WHERE id = ?").bind(enabled ? 1 : 0, id).run();
}

// Scheduler wakes every 15 minutes, so shorter intervals would never fire on time.
export const MIN_SYNC_INTERVAL_MINUTES = 15;
export const MAX_SYNC_INTERVAL_MINUTES = 7 * 24 * 60;

export async function setSourceSyncInterval(env: AppEnv, id: number, minutes: number | null) {
  await ensureSchema(env.DB);
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < MIN_SYNC_INTERVAL_MINUTES || minutes > MAX_SYNC_INTERVAL_MINUTES)) {
    throw new Error("拉取间隔需在 15 分钟到 7 天之间，或传 null 恢复默认节奏");
  }
  const source = await env.DB.prepare("SELECT kind FROM sources WHERE id = ?").bind(id).first<{ kind: string }>();
  if (!source) throw new Error("这个订阅源不存在");
  if (source.kind !== "rss" && source.kind !== "x") throw new Error("公众号与推文源由采集端更新，云端不支持配置拉取间隔");
  await env.DB.prepare("UPDATE sources SET sync_interval_minutes = ? WHERE id = ?").bind(minutes, id).run();
}

export async function deleteSource(env: AppEnv, id: number) {
  await ensureSchema(env.DB);
  const source = await env.DB.prepare("SELECT id FROM sources WHERE id = ?").bind(id).first();
  if (!source) throw new Error("这个订阅源不存在");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM user_source_follows WHERE source_id = ?").bind(id),
    env.DB.prepare("DELETE FROM annotation_replies WHERE annotation_id IN (SELECT id FROM annotations WHERE item_id IN (SELECT id FROM items WHERE source_id = ?))").bind(id),
    env.DB.prepare("DELETE FROM annotations WHERE item_id IN (SELECT id FROM items WHERE source_id = ?)").bind(id),
    env.DB.prepare("DELETE FROM daily_reading_activity WHERE item_id IN (SELECT id FROM items WHERE source_id = ?)").bind(id),
    env.DB.prepare("DELETE FROM user_item_states WHERE item_id IN (SELECT id FROM items WHERE source_id = ?)").bind(id),
    env.DB.prepare("DELETE FROM items WHERE source_id = ?").bind(id),
    env.DB.prepare("DELETE FROM sync_runs WHERE source_id = ?").bind(id),
    env.DB.prepare("DELETE FROM sources WHERE id = ?").bind(id),
  ]);
}

export async function assertSourceContributor(env: AppEnv, id: number, userId: number) {
  await ensureSchema(env.DB);
  const source = await env.DB.prepare("SELECT contributor_user_id AS contributorUserId FROM sources WHERE id = ?").bind(id).first<{ contributorUserId: number | null }>();
  if (!source) throw new Error("这个订阅源不存在");
  if (source.contributorUserId !== userId) throw new Error(source.contributorUserId ? "只有贡献者可以管理这个订阅源" : "站点收录的来源暂不支持用户管理");
}

export async function captureLink(env: AppEnv, url: string, title?: string) {
  await ensureSchema(env.DB);
  const normalized = publicHttpUrl(url.trim()).toString();
  if (title && title.trim().length > 240) throw new Error("标题最多 240 个字");

  let resolvedTitle = title?.trim() || "";
  let excerpt = "";
  let contentMarkdown: string | null = null;
  let author: string | null = null;
  let publishedAt: string | null = null;
  if (xPostAddress(normalized)) {
    try {
      const post = await readXPost(normalized);
      if (post) {
        resolvedTitle = post.title;
        excerpt = post.excerpt;
        contentMarkdown = post.contentMarkdown;
        author = post.author;
        publishedAt = post.publishedAt;
      }
    } catch {
      // Keep the public link even when the free X reader is temporarily unavailable.
    }
  }
  if (!resolvedTitle) {
    try {
      const { response, text: html } = await fetchPublicText(normalized, { maxBytes: 300_000 });
      if (response.ok) {
        resolvedTitle = readMeta(html, "og:title") || readTag(html, "title") || "待处理链接";
        excerpt = readMeta(html, "og:description") || readMeta(html, "description");
      }
    } catch {
      // Some platforms block server-side previews. The link is still worth keeping.
    }
  }
  const fallbackTitle = xPostAddress(normalized) ? "X 文章" : "待处理链接";
  await env.DB.prepare("INSERT INTO items (kind, title, original_excerpt, content_markdown, author, url, published_at, language, status, created_at) VALUES ('link', ?, ?, ?, ?, ?, ?, ?, 'needs_ai', ?) ON CONFLICT(url) DO UPDATE SET title = CASE WHEN excluded.title <> '待处理链接' AND excluded.title <> 'X 文章' THEN excluded.title ELSE items.title END, original_excerpt = CASE WHEN excluded.original_excerpt <> '' THEN excluded.original_excerpt ELSE items.original_excerpt END, content_markdown = COALESCE(excluded.content_markdown, items.content_markdown), author = COALESCE(excluded.author, items.author), published_at = COALESCE(excluded.published_at, items.published_at)")
    .bind(resolvedTitle || fallbackTitle, excerpt, contentMarkdown, author, normalized, publishedAt, /[\u4e00-\u9fff]/.test(`${resolvedTitle}${excerpt}`) ? "zh" : "unknown", now()).run();
  const item = await env.DB.prepare("SELECT id FROM items WHERE url = ?").bind(normalized).first<{ id: number }>();
  if (!item) throw new Error("文章保存失败");
  return { id: item.id, contentReady: Boolean(contentMarkdown && contentMarkdown.length > 40) };
}

export async function requestSubscription(env: AppEnv, query: string, kind = "unknown", requesterUserId: number | null = null, category: SourceCategory | null = null) {
  await ensureSchema(env.DB);
  const clean = query.trim();
  if (!clean || clean.length > 200) throw new Error("请输入公众号、X 账号或网站名称");
  await env.DB.prepare("INSERT INTO subscription_requests (query, kind, category, status, stage, result_name, item_count, requester_user_id, last_error, created_at, updated_at) VALUES (?, ?, ?, 'pending', 'queued', NULL, 0, ?, NULL, ?, ?) ON CONFLICT(query) DO UPDATE SET kind = excluded.kind, category = COALESCE(excluded.category, subscription_requests.category), status = 'pending', stage = 'queued', result_name = NULL, item_count = 0, requester_user_id = excluded.requester_user_id, last_error = NULL, updated_at = excluded.updated_at")
    .bind(clean, kind, category, requesterUserId, now(), now()).run();
  const request = await env.DB.prepare("SELECT id FROM subscription_requests WHERE query = ?").bind(clean).first<{ id: number }>();
  if (!request) throw new Error("公众号任务创建失败");
  return request.id;
}

export async function pendingWechatSubscriptions(env: AppEnv) {
  await ensureSchema(env.DB);
  const rows = await env.DB.prepare("SELECT id, query, stage, result_name AS resultName, item_count AS itemCount, last_error AS lastError, created_at AS createdAt FROM subscription_requests WHERE kind = 'wechat' AND status = 'pending' ORDER BY created_at LIMIT 20")
    .all<{ id: number; query: string; stage: string; resultName: string | null; itemCount: number; lastError: string | null; createdAt: string }>();
  return rows.results;
}

export async function updateSubscriptionRequest(env: AppEnv, id: number, status: "pending" | "completed" | "failed", error = "", stage = "queued", resultName = "", itemCount = 0) {
  await ensureSchema(env.DB);
  await env.DB.prepare("UPDATE subscription_requests SET status = ?, stage = ?, result_name = COALESCE(NULLIF(?, ''), result_name), item_count = CASE WHEN ? > item_count THEN ? ELSE item_count END, last_error = ?, updated_at = ? WHERE id = ?")
    .bind(status, stage, resultName, itemCount, itemCount, error || null, now(), id).run();
}

export async function promotePendingXArticles(env: AppEnv) {
  const pending = await env.DB.prepare("SELECT id, query FROM subscription_requests WHERE status = 'pending' ORDER BY created_at LIMIT 3")
    .all<{ id: number; query: string }>();
  for (const request of pending.results) {
    if (!xPostAddress(request.query)) continue;
    try {
      await captureLink(env, request.query);
      await env.DB.prepare("UPDATE subscription_requests SET status = 'completed' WHERE id = ?").bind(request.id).run();
    } catch {
      // Keep it pending so a later page load can retry a temporary reader failure.
    }
  }
}

type ImportedArticle = { title: string; url: string; excerpt?: string; contentMarkdown?: string; author?: string; publishedAt?: string };

export async function importWechatArticles(env: AppEnv, accountKey: string, accountName: string, articles: ImportedArticle[], requestId: number | null = null, avatarUrl = "") {
  await ensureSchema(env.DB);
  const cleanName = accountName.trim();
  const cleanKey = accountKey.trim();
  if (!cleanName || cleanName.length > 80 || !/^[A-Za-z0-9_+=/-]{4,200}$/.test(cleanKey)) throw new Error("公众号信息不合法");
  if (!Array.isArray(articles) || articles.length === 0 || articles.length > 100) throw new Error("单次导入文章数量应为 1–100 篇");
  const sourceUrl = `wechat://${cleanKey}`;
  const queued = requestId ? await env.DB.prepare("SELECT requester_user_id AS requesterUserId, category FROM subscription_requests WHERE id = ?").bind(requestId).first<{ requesterUserId: number | null; category: SourceCategory | null }>() : null;
  const contributorUserId = queued?.requesterUserId || null;
  const category = isSourceCategory(queued?.category) ? queued.category : inferSourceCategory(cleanName, articles.map((article) => article.title));
  let cleanAvatarUrl: string | null = null;
  if (avatarUrl.trim()) {
    try {
      const parsedAvatar = publicHttpUrl(avatarUrl.trim().replace(/^http:/i, "https:"));
      cleanAvatarUrl = parsedAvatar.toString();
    } catch {
      cleanAvatarUrl = null;
    }
  }
  let source = await env.DB.prepare("SELECT id FROM sources WHERE url = ? OR (kind = 'wechat' AND name = ?) ORDER BY CASE WHEN url = ? THEN 0 ELSE 1 END LIMIT 1")
    .bind(sourceUrl, cleanName, sourceUrl).first<{ id: number }>();
  if (source) {
    await env.DB.prepare("UPDATE sources SET kind = 'wechat', category = COALESCE(category, ?), name = ?, url = ?, last_synced_at = ?, last_error = NULL, avatar_url = COALESCE(?, avatar_url) WHERE id = ?")
      .bind(category, cleanName, sourceUrl, now(), cleanAvatarUrl, source.id).run();
  } else {
    await env.DB.prepare("INSERT INTO sources (kind, category, name, url, last_synced_at, avatar_url, contributor_user_id, created_at) VALUES ('wechat', ?, ?, ?, ?, ?, ?, ?)")
      .bind(category, cleanName, sourceUrl, now(), cleanAvatarUrl, contributorUserId, now()).run();
    source = await env.DB.prepare("SELECT id FROM sources WHERE url = ?").bind(sourceUrl).first<{ id: number }>();
  }
  if (!source) throw new Error("公众号来源创建失败");
  if (contributorUserId) await setSourceFollowing(env, source.id, contributorUserId, true);

  let added = 0;
  for (const article of articles) {
    const title = article.title?.trim();
    const url = publicHttpUrl(article.url?.trim()).toString();
    const excerpt = article.excerpt?.trim().slice(0, 1200) || "";
    if (!title || title.length > 300) continue;
    const isChinese = /[\u4e00-\u9fff]/.test(`${title}${excerpt}`.slice(0, 160));
    const contentMarkdown = article.contentMarkdown?.trim().slice(0, 120_000) || null;
    const author = article.author?.trim().slice(0, 120) || cleanName;
    const existing = await env.DB.prepare("SELECT id FROM items WHERE url = ?").bind(url).first();
    await env.DB.prepare("INSERT INTO items (source_id, kind, title, original_excerpt, content_markdown, author, translated_title, translated_excerpt, url, published_at, language, status, created_at) VALUES (?, 'link', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(url) DO UPDATE SET source_id = excluded.source_id, title = excluded.title, original_excerpt = CASE WHEN excluded.original_excerpt <> '' THEN excluded.original_excerpt ELSE items.original_excerpt END, content_markdown = COALESCE(excluded.content_markdown, items.content_markdown), author = COALESCE(excluded.author, items.author), translated_title = COALESCE(excluded.translated_title, items.translated_title), translated_excerpt = CASE WHEN excluded.translated_excerpt <> '' THEN excluded.translated_excerpt ELSE items.translated_excerpt END, published_at = COALESCE(excluded.published_at, items.published_at), language = excluded.language, status = excluded.status")
      .bind(source.id, title, excerpt, contentMarkdown, author, isChinese ? title : null, isChinese ? excerpt : null, url, article.publishedAt || null, isChinese ? "zh" : "unknown", isChinese ? "ready" : "needs_ai", now()).run();
    if (!existing) added += 1;
  }
  return added;
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, " ").trim();
}

function readMeta(html: string, key: string) {
  const safe = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${safe}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${safe}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return stripHtml(match[1]);
  }
  return "";
}

function readTag(html: string, tag: string) {
  return stripHtml(html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || "");
}

export async function updateItem(env: AppEnv, id: number, action: "read" | "save", userId: number) {
  await ensureSchema(env.DB);
  const item = await env.DB.prepare("SELECT id FROM items WHERE id = ?").bind(id).first();
  if (!item) throw new Error("这篇文章不存在");
  const timestamp = now();
  await env.DB.prepare("INSERT INTO user_item_states (user_id, item_id, is_read, read_at, is_saved, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, item_id) DO UPDATE SET is_read = CASE WHEN ? = 'read' THEN CASE user_item_states.is_read WHEN 1 THEN 0 ELSE 1 END ELSE user_item_states.is_read END, read_at = CASE WHEN ? = 'read' AND user_item_states.is_read = 0 THEN ? ELSE user_item_states.read_at END, is_saved = CASE WHEN ? = 'save' THEN CASE user_item_states.is_saved WHEN 1 THEN 0 ELSE 1 END ELSE user_item_states.is_saved END, updated_at = excluded.updated_at")
    .bind(userId, id, action === "read" ? 1 : 0, action === "read" ? timestamp : null, action === "save" ? 1 : 0, timestamp, action, action, timestamp, action).run();
}

export async function markItemRead(env: AppEnv, id: number, userId: number) {
  await ensureSchema(env.DB);
  const timestamp = now();
  await env.DB.prepare("INSERT INTO user_item_states (user_id, item_id, is_read, read_at, is_saved, updated_at) VALUES (?, ?, 1, ?, 0, ?) ON CONFLICT(user_id, item_id) DO UPDATE SET is_read = 1, read_at = COALESCE(user_item_states.read_at, excluded.read_at), updated_at = excluded.updated_at")
    .bind(userId, id, timestamp, timestamp).run();
}

export async function listSourceItems(env: AppEnv, sourceId: number, userId: number | null = null) {
  await ensureSchema(env.DB);
  const source = await env.DB.prepare("SELECT id FROM sources WHERE id = ?").bind(sourceId).first();
  if (!source) throw new Error("这个订阅源不存在");
  const rows = await env.DB.prepare("SELECT i.id, i.source_id AS sourceId, i.kind, i.title, i.author, i.original_excerpt AS originalExcerpt, i.translated_title AS translatedTitle, i.translated_excerpt AS translatedExcerpt, i.url, i.published_at AS publishedAt, i.language, i.topic, i.status, COALESCE(uis.is_read, 0) AS isRead, COALESCE(uis.is_saved, 0) AS isSaved, s.name AS sourceName FROM items i LEFT JOIN sources s ON s.id = i.source_id LEFT JOIN user_item_states uis ON uis.item_id = i.id AND uis.user_id = ? WHERE i.source_id = ? ORDER BY CASE WHEN i.published_at IS NULL OR i.published_at = '' THEN 1 ELSE 0 END, i.published_at DESC, i.id DESC LIMIT 500")
    .bind(userId || -1, sourceId).all();
  return rows.results;
}

export async function getItemDetail(env: AppEnv, id: number, userId: number | null = null) {
  await ensureSchema(env.DB);
  const item = await env.DB.prepare("SELECT i.id, i.source_id AS sourceId, i.title, i.author, i.original_excerpt AS originalExcerpt, i.content_markdown AS contentMarkdown, i.translated_title AS translatedTitle, i.translated_excerpt AS translatedExcerpt, i.url, i.published_at AS publishedAt, i.topic, COALESCE(uis.is_read, 0) AS isRead, COALESCE(uis.is_saved, 0) AS isSaved, s.name AS sourceName FROM items i LEFT JOIN sources s ON s.id = i.source_id LEFT JOIN user_item_states uis ON uis.item_id = i.id AND uis.user_id = ? WHERE i.id = ?").bind(userId || -1, id).first<Record<string, unknown>>();
  if (!item) throw new Error("这篇文章不存在");
  const itemUrl = String(item.url || "");
  if (xPostAddress(itemUrl)) {
    if (typeof item.contentMarkdown === "string" && item.contentMarkdown.trim().length > 800) return item;
    try {
      const post = await readXPost(itemUrl);
      if (post?.contentMarkdown) {
        await env.DB.prepare("UPDATE items SET title = ?, original_excerpt = ?, content_markdown = ?, author = ?, published_at = COALESCE(?, published_at) WHERE id = ?")
          .bind(post.title, post.excerpt, post.contentMarkdown, post.author, post.publishedAt, id).run();
        return { ...item, title: post.title, originalExcerpt: post.excerpt, contentMarkdown: post.contentMarkdown, author: post.author, publishedAt: post.publishedAt || item.publishedAt };
      }
    } catch {
      // Keep the timeline copy when the free full-text reader is temporarily unavailable.
    }
  }
  if (typeof item.contentMarkdown === "string" && item.contentMarkdown.trim().length > 160) {
    const stored = item.contentMarkdown.trim();
    const normalized = /<(?:a|blockquote|br|div|figure|h[1-6]|img|li|ol|p|section|strong|ul)\b/i.test(stored) ? htmlToMarkdown(stored) : stored;
    if (normalized !== stored) await env.DB.prepare("UPDATE items SET content_markdown = ? WHERE id = ?").bind(normalized, id).run();
    return { ...item, contentMarkdown: normalized };
  }

  try {
    const { response, text: html } = await fetchPublicText(itemUrl, { maxBytes: 2_000_000 });
    if (response.ok) {
      const extracted = extractArticle(html);
      const markdown = extracted.markdown.length > 160 ? extracted.markdown : String(item.originalExcerpt || item.translatedExcerpt || "");
      const author = extracted.author || String(item.author || "") || readHtmlMeta(html, "byl");
      await env.DB.prepare("UPDATE items SET content_markdown = ?, author = COALESCE(NULLIF(?, ''), author) WHERE id = ?").bind(markdown, author, id).run();
      return { ...item, contentMarkdown: markdown, author: author || item.author };
    }
  } catch {
    // Sites that block readers still get the saved summary instead of a broken pane.
  }
  return { ...item, contentMarkdown: item.originalExcerpt || item.translatedExcerpt || "暂时无法读取完整正文，可以从右上角打开原网页。" };
}

type AnnotationRow = {
  id: number;
  itemId: number;
  userId: number;
  nickname: string;
  avatarKey: string | null;
  quote: string;
  body: string;
  blockIndex: number;
  startOffset: number;
  endOffset: number;
  createdAt: string;
  updatedAt: string;
  replyCount: number;
  itemTitle?: string;
  itemAuthor?: string | null;
  sourceName?: string | null;
};

type AnnotationReplyRow = {
  id: number;
  annotationId: number;
  userId: number;
  nickname: string;
  avatarKey: string | null;
  replyToUserId: number | null;
  replyToNickname: string | null;
  body: string;
  createdAt: string;
};

function avatarUrl(userId: number, avatarKey: string | null) {
  if (!avatarKey) return null;
  const version = avatarKey.split("/").at(-1) || avatarKey;
  return `/api/profile/avatar?id=${userId}&v=${encodeURIComponent(version)}`;
}

function cleanAnnotationText(value: unknown, label: string, limit: number) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label}不能为空`);
  if (text.length > limit) throw new Error(`${label}最多 ${limit} 个字符`);
  return text;
}

async function hydrateAnnotations(env: AppEnv, rows: AnnotationRow[]) {
  if (!rows.length) return [];
  const placeholders = rows.map(() => "?").join(",");
  const replies = await env.DB.prepare(`SELECT r.id, r.annotation_id AS annotationId, r.user_id AS userId, u.nickname, u.avatar_key AS avatarKey, r.reply_to_user_id AS replyToUserId, target.nickname AS replyToNickname, r.body, r.created_at AS createdAt FROM annotation_replies r JOIN users u ON u.id = r.user_id LEFT JOIN users target ON target.id = r.reply_to_user_id WHERE r.annotation_id IN (${placeholders}) ORDER BY r.created_at ASC, r.id ASC`)
    .bind(...rows.map((row) => row.id)).all<AnnotationReplyRow>();
  const byAnnotation = new Map<number, AnnotationReplyRow[]>();
  for (const reply of replies.results) {
    const current = byAnnotation.get(reply.annotationId) || [];
    current.push(reply);
    byAnnotation.set(reply.annotationId, current);
  }
  return rows.map((row) => ({
    ...row,
    avatarUrl: avatarUrl(row.userId, row.avatarKey),
    avatarKey: undefined,
    replies: (byAnnotation.get(row.id) || []).map((reply) => ({ ...reply, avatarUrl: avatarUrl(reply.userId, reply.avatarKey), avatarKey: undefined })),
  }));
}

const ANNOTATION_SELECT = "SELECT a.id, a.item_id AS itemId, a.user_id AS userId, u.nickname, u.avatar_key AS avatarKey, a.quote, a.body, a.block_index AS blockIndex, a.start_offset AS startOffset, a.end_offset AS endOffset, a.created_at AS createdAt, a.updated_at AS updatedAt, (SELECT COUNT(*) FROM annotation_replies r WHERE r.annotation_id = a.id) AS replyCount";

export async function listItemAnnotations(env: AppEnv, itemId: number) {
  await ensureSchema(env.DB);
  const item = await env.DB.prepare("SELECT id FROM items WHERE id = ?").bind(itemId).first();
  if (!item) throw new Error("这篇文章不存在");
  const rows = await env.DB.prepare(`${ANNOTATION_SELECT} FROM annotations a JOIN users u ON u.id = a.user_id WHERE a.item_id = ? ORDER BY a.block_index ASC, a.start_offset ASC, a.created_at ASC`)
    .bind(itemId).all<AnnotationRow>();
  return hydrateAnnotations(env, rows.results);
}

export async function createAnnotation(env: AppEnv, userId: number, input: { itemId?: unknown; quote?: unknown; body?: unknown; blockIndex?: unknown; startOffset?: unknown; endOffset?: unknown }) {
  await ensureSchema(env.DB);
  const itemId = Number(input.itemId);
  const blockIndex = Number(input.blockIndex);
  const startOffset = Number(input.startOffset);
  const endOffset = Number(input.endOffset);
  if (!Number.isInteger(itemId) || itemId <= 0) throw new Error("文章 ID 不合法");
  if (!Number.isInteger(blockIndex) || blockIndex < 0 || !Number.isInteger(startOffset) || startOffset < 0 || !Number.isInteger(endOffset) || endOffset <= startOffset) throw new Error("选中的原文位置不合法");
  const quote = cleanAnnotationText(input.quote, "引用原文", 800);
  const body = cleanAnnotationText(input.body, "批注", 1000);
  const item = await env.DB.prepare("SELECT id FROM items WHERE id = ?").bind(itemId).first();
  if (!item) throw new Error("这篇文章不存在");
  const timestamp = now();
  const inserted = await env.DB.prepare("INSERT INTO annotations (item_id, user_id, quote, body, block_index, start_offset, end_offset, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(itemId, userId, quote, body, blockIndex, startOffset, endOffset, timestamp, timestamp).run();
  const rows = await env.DB.prepare(`${ANNOTATION_SELECT} FROM annotations a JOIN users u ON u.id = a.user_id WHERE a.id = ?`)
    .bind(Number(inserted.meta.last_row_id)).all<AnnotationRow>();
  return (await hydrateAnnotations(env, rows.results))[0];
}

export async function createAnnotationReply(env: AppEnv, userId: number, input: { annotationId?: unknown; replyToUserId?: unknown; body?: unknown }) {
  await ensureSchema(env.DB);
  const annotationId = Number(input.annotationId);
  const replyToUserId = input.replyToUserId ? Number(input.replyToUserId) : null;
  if (!Number.isInteger(annotationId) || annotationId <= 0) throw new Error("批注 ID 不合法");
  if (replyToUserId !== null && (!Number.isInteger(replyToUserId) || replyToUserId <= 0)) throw new Error("回复对象不合法");
  const body = cleanAnnotationText(input.body, "回复", 500);
  const annotation = await env.DB.prepare("SELECT id, user_id AS userId FROM annotations WHERE id = ?").bind(annotationId).first<{ id: number; userId: number }>();
  if (!annotation) throw new Error("这条批注不存在");
  if (replyToUserId !== null) {
    const target = await env.DB.prepare("SELECT u.id FROM users u WHERE u.id = ? AND (u.id = ? OR EXISTS (SELECT 1 FROM annotation_replies r WHERE r.annotation_id = ? AND r.user_id = u.id))")
      .bind(replyToUserId, annotation.userId, annotationId).first();
    if (!target) throw new Error("回复的用户不存在");
  }
  const timestamp = now();
  const inserted = await env.DB.prepare("INSERT INTO annotation_replies (annotation_id, user_id, reply_to_user_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(annotationId, userId, replyToUserId, body, timestamp, timestamp).run();
  const reply = await env.DB.prepare("SELECT r.id, r.annotation_id AS annotationId, r.user_id AS userId, u.nickname, u.avatar_key AS avatarKey, r.reply_to_user_id AS replyToUserId, target.nickname AS replyToNickname, r.body, r.created_at AS createdAt FROM annotation_replies r JOIN users u ON u.id = r.user_id LEFT JOIN users target ON target.id = r.reply_to_user_id WHERE r.id = ?")
    .bind(Number(inserted.meta.last_row_id)).first<AnnotationReplyRow>();
  if (!reply) throw new Error("回复保存失败");
  const notificationUserId = replyToUserId || annotation.userId;
  if (notificationUserId !== userId) {
    await env.DB.prepare("INSERT INTO notifications (user_id, actor_user_id, type, annotation_id, profile_message_id, is_read, created_at) VALUES (?, ?, 'annotation_reply', ?, NULL, 0, ?)")
      .bind(notificationUserId, userId, annotationId, timestamp).run();
  }
  return { ...reply, avatarUrl: avatarUrl(reply.userId, reply.avatarKey), avatarKey: undefined };
}

export async function listAnnotationPlaza(env: AppEnv, sort: "latest" | "hot") {
  await ensureSchema(env.DB);
  const order = sort === "hot" ? "replyCount DESC, a.created_at DESC" : "a.created_at DESC";
  const rows = await env.DB.prepare(`${ANNOTATION_SELECT}, COALESCE(i.translated_title, i.title) AS itemTitle, COALESCE(i.author, s.name, '未知作者') AS itemAuthor, s.name AS sourceName FROM annotations a JOIN users u ON u.id = a.user_id JOIN items i ON i.id = a.item_id LEFT JOIN sources s ON s.id = i.source_id ORDER BY ${order} LIMIT 80`)
    .all<AnnotationRow>();
  return hydrateAnnotations(env, rows.results);
}

export async function listUserAnnotations(env: AppEnv, userId: number) {
  await ensureSchema(env.DB);
  const rows = await env.DB.prepare(`${ANNOTATION_SELECT}, COALESCE(i.translated_title, i.title) AS itemTitle, COALESCE(i.author, s.name, '未知作者') AS itemAuthor, s.name AS sourceName FROM annotations a JOIN users u ON u.id = a.user_id JOIN items i ON i.id = a.item_id LEFT JOIN sources s ON s.id = i.source_id WHERE a.user_id = ? ORDER BY a.created_at DESC LIMIT 200`)
    .bind(userId).all<AnnotationRow>();
  return hydrateAnnotations(env, rows.results);
}

type PublicProfileUserRow = {
  id: number;
  account: string;
  nickname: string;
  bio: string;
  avatarKey: string | null;
  createdAt: string;
};

type ProfileMessageRow = {
  id: number;
  authorUserId: number;
  nickname: string;
  avatarKey: string | null;
  body: string;
  createdAt: string;
};

export async function getPublicProfile(env: AppEnv, profileUserId: number, viewerUserId: number | null) {
  await ensureSchema(env.DB);
  if (!Number.isInteger(profileUserId) || profileUserId <= 0) throw new Error("用户不存在");
  const user = await env.DB.prepare("SELECT id, account, nickname, bio, avatar_key AS avatarKey, created_at AS createdAt FROM users WHERE id = ?")
    .bind(profileUserId).first<PublicProfileUserRow>();
  if (!user) throw new Error("用户不存在");
  const [reading, followed, contribution, likes, liked, followedSources, messages, recentLikers, annotations] = await Promise.all([
    env.DB.prepare("SELECT COUNT(DISTINCT CASE WHEN counted_at IS NOT NULL THEN item_id END) AS readCount, COALESCE(SUM(active_seconds), 0) AS readSeconds FROM daily_reading_activity WHERE user_id = ?").bind(profileUserId).first<{ readCount: number; readSeconds: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM user_source_follows WHERE user_id = ?").bind(profileUserId).first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM sources WHERE contributor_user_id = ?").bind(profileUserId).first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM profile_likes WHERE profile_user_id = ?").bind(profileUserId).first<{ count: number }>(),
    viewerUserId ? env.DB.prepare("SELECT 1 AS liked FROM profile_likes WHERE user_id = ? AND profile_user_id = ?").bind(viewerUserId, profileUserId).first<{ liked: number }>() : Promise.resolve(null),
    env.DB.prepare("SELECT s.id, s.kind, s.category, s.name, s.url, s.avatar_url AS avatarUrl, (SELECT COUNT(*) FROM items i WHERE i.source_id = s.id) AS itemCount FROM user_source_follows f JOIN sources s ON s.id = f.source_id WHERE f.user_id = ? ORDER BY f.created_at DESC, s.id DESC LIMIT 24").bind(profileUserId).all(),
    env.DB.prepare("SELECT m.id, m.author_user_id AS authorUserId, u.nickname, u.avatar_key AS avatarKey, m.body, m.created_at AS createdAt FROM profile_messages m JOIN users u ON u.id = m.author_user_id WHERE m.profile_user_id = ? ORDER BY m.created_at DESC, m.id DESC LIMIT 50").bind(profileUserId).all<ProfileMessageRow>(),
    env.DB.prepare("SELECT u.id, u.nickname, u.avatar_key AS avatarKey FROM profile_likes l JOIN users u ON u.id = l.user_id WHERE l.profile_user_id = ? ORDER BY l.created_at DESC LIMIT 8").bind(profileUserId).all<{ id: number; nickname: string; avatarKey: string | null }>(),
    listUserAnnotations(env, profileUserId),
  ]);
  return {
    user: { ...user, avatarUrl: avatarUrl(user.id, user.avatarKey), avatarKey: undefined },
    isOwner: viewerUserId === profileUserId,
    metrics: {
      readCount: Number(reading?.readCount || 0),
      readSeconds: Number(reading?.readSeconds || 0),
      followedCount: Number(followed?.count || 0),
      contributionCount: Number(contribution?.count || 0),
    },
    likes: {
      count: Number(likes?.count || 0),
      likedByViewer: Boolean(liked?.liked),
      recent: recentLikers.results.map((liker) => ({ ...liker, avatarUrl: avatarUrl(liker.id, liker.avatarKey), avatarKey: undefined })),
    },
    annotations,
    followedSources: followedSources.results,
    messages: messages.results.map((message) => ({ ...message, avatarUrl: avatarUrl(message.authorUserId, message.avatarKey), avatarKey: undefined })),
  };
}

export async function toggleProfileLike(env: AppEnv, userId: number, profileUserId: number) {
  await ensureSchema(env.DB);
  if (!Number.isInteger(profileUserId) || profileUserId <= 0) throw new Error("用户不存在");
  if (userId === profileUserId) throw new Error("不能给自己的主页点赞");
  const target = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(profileUserId).first();
  if (!target) throw new Error("用户不存在");
  const existing = await env.DB.prepare("SELECT 1 AS liked FROM profile_likes WHERE user_id = ? AND profile_user_id = ?").bind(userId, profileUserId).first();
  if (existing) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM profile_likes WHERE user_id = ? AND profile_user_id = ?").bind(userId, profileUserId),
      env.DB.prepare("DELETE FROM notifications WHERE user_id = ? AND actor_user_id = ? AND type = 'profile_like' AND is_read = 0").bind(profileUserId, userId),
    ]);
  } else {
    const timestamp = now();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO profile_likes (user_id, profile_user_id, created_at) VALUES (?, ?, ?)").bind(userId, profileUserId, timestamp),
      env.DB.prepare("INSERT INTO notifications (user_id, actor_user_id, type, annotation_id, profile_message_id, is_read, created_at) VALUES (?, ?, 'profile_like', NULL, NULL, 0, ?)").bind(profileUserId, userId, timestamp),
    ]);
  }
  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM profile_likes WHERE profile_user_id = ?").bind(profileUserId).first<{ count: number }>();
  return { liked: !existing, count: Number(count?.count || 0) };
}

export async function createProfileMessage(env: AppEnv, userId: number, profileUserId: number, bodyInput: unknown) {
  await ensureSchema(env.DB);
  if (!Number.isInteger(profileUserId) || profileUserId <= 0) throw new Error("用户不存在");
  if (userId === profileUserId) throw new Error("不能给自己的主页留言");
  const body = cleanAnnotationText(bodyInput, "留言", 500);
  const target = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(profileUserId).first();
  if (!target) throw new Error("用户不存在");
  const timestamp = now();
  const inserted = await env.DB.prepare("INSERT INTO profile_messages (profile_user_id, author_user_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind(profileUserId, userId, body, timestamp, timestamp).run();
  const messageId = Number(inserted.meta.last_row_id);
  await env.DB.prepare("INSERT INTO notifications (user_id, actor_user_id, type, annotation_id, profile_message_id, is_read, created_at) VALUES (?, ?, 'profile_message', NULL, ?, 0, ?)")
    .bind(profileUserId, userId, messageId, timestamp).run();
  const message = await env.DB.prepare("SELECT m.id, m.author_user_id AS authorUserId, u.nickname, u.avatar_key AS avatarKey, m.body, m.created_at AS createdAt FROM profile_messages m JOIN users u ON u.id = m.author_user_id WHERE m.id = ?")
    .bind(messageId).first<ProfileMessageRow>();
  if (!message) throw new Error("留言保存失败");
  return { ...message, avatarUrl: avatarUrl(message.authorUserId, message.avatarKey), avatarKey: undefined };
}

export async function listNotifications(env: AppEnv, userId: number) {
  await ensureSchema(env.DB);
  const rows = await env.DB.prepare("SELECT n.id, n.type, n.actor_user_id AS actorUserId, u.nickname AS actorNickname, u.avatar_key AS actorAvatarKey, n.annotation_id AS annotationId, a.item_id AS itemId, n.profile_message_id AS profileMessageId, n.is_read AS isRead, n.created_at AS createdAt FROM notifications n JOIN users u ON u.id = n.actor_user_id LEFT JOIN annotations a ON a.id = n.annotation_id WHERE n.user_id = ? ORDER BY n.created_at DESC, n.id DESC LIMIT 40")
    .bind(userId).all<{ id: number; type: "annotation_reply" | "profile_message" | "profile_like"; actorUserId: number; actorNickname: string; actorAvatarKey: string | null; annotationId: number | null; itemId: number | null; profileMessageId: number | null; isRead: number; createdAt: string }>();
  return rows.results.map((row) => ({ ...row, actorAvatarUrl: avatarUrl(row.actorUserId, row.actorAvatarKey), actorAvatarKey: undefined }));
}

export async function markNotificationsRead(env: AppEnv, userId: number, notificationId?: number) {
  await ensureSchema(env.DB);
  if (notificationId !== undefined) {
    if (!Number.isInteger(notificationId) || notificationId <= 0) throw new Error("通知不存在");
    await env.DB.prepare("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?").bind(notificationId, userId).run();
  } else {
    await env.DB.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0").bind(userId).run();
  }
}

function shanghaiDay(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

export async function recordReadingHeartbeat(env: AppEnv, userId: number, itemId: number) {
  await ensureSchema(env.DB);
  const item = await env.DB.prepare("SELECT id FROM items WHERE id = ?").bind(itemId).first();
  if (!item) throw new Error("这篇文章不存在");
  const timestamp = new Date();
  const iso = timestamp.toISOString();
  const activityDay = shanghaiDay(timestamp);
  const activity = await env.DB.prepare("SELECT active_seconds AS activeSeconds, last_heartbeat_at AS lastHeartbeatAt FROM daily_reading_activity WHERE user_id = ? AND item_id = ? AND day = ?")
    .bind(userId, itemId, activityDay).first<{ activeSeconds: number; lastHeartbeatAt: string }>();
  if (!activity) {
    await env.DB.prepare("INSERT INTO daily_reading_activity (user_id, item_id, day, active_seconds, last_heartbeat_at, counted_at, created_at, updated_at) VALUES (?, ?, ?, 0, ?, NULL, ?, ?)")
      .bind(userId, itemId, activityDay, iso, iso, iso).run();
    return { activeSeconds: 0, qualified: false, day: activityDay };
  }
  const elapsed = Math.max(0, Math.floor((timestamp.getTime() - new Date(activity.lastHeartbeatAt).getTime()) / 1000));
  const increment = elapsed >= 5 && elapsed <= 35 ? Math.min(elapsed, 20) : 0;
  const activeSeconds = Number(activity.activeSeconds || 0) + increment;
  const countedAt = activeSeconds >= 10 ? iso : null;
  await env.DB.prepare("UPDATE daily_reading_activity SET active_seconds = ?, last_heartbeat_at = ?, counted_at = COALESCE(counted_at, ?), updated_at = ? WHERE user_id = ? AND item_id = ? AND day = ?")
    .bind(activeSeconds, iso, countedAt, iso, userId, itemId, activityDay).run();
  return { activeSeconds, qualified: activeSeconds >= 10, day: activityDay };
}

export async function leaderboard(env: AppEnv, period: "today" | "yesterday") {
  await ensureSchema(env.DB);
  const target = new Date();
  if (period === "yesterday") target.setUTCDate(target.getUTCDate() - 1);
  const targetDay = shanghaiDay(target);
  const [reading, contribution] = await Promise.all([
    env.DB.prepare("SELECT u.id, u.nickname, u.avatar_key AS avatarKey, COUNT(CASE WHEN a.active_seconds >= 10 THEN 1 END) AS readCount, COALESCE(SUM(CASE WHEN a.active_seconds >= 10 THEN a.active_seconds ELSE 0 END), 0) AS readSeconds, u.created_at AS createdAt FROM users u LEFT JOIN daily_reading_activity a ON a.user_id = u.id AND a.day = ? GROUP BY u.id ORDER BY readCount DESC, readSeconds DESC, u.created_at ASC")
      .bind(targetDay).all<{ id: number; nickname: string; avatarKey: string | null; readCount: number; readSeconds: number; createdAt: string }>(),
    env.DB.prepare("SELECT u.id, u.nickname, u.avatar_key AS avatarKey, COUNT(s.id) AS contributionCount, MIN(s.created_at) AS firstContributionAt, u.created_at AS createdAt FROM users u LEFT JOIN sources s ON s.contributor_user_id = u.id GROUP BY u.id ORDER BY contributionCount DESC, firstContributionAt ASC, u.created_at ASC")
      .all<{ id: number; nickname: string; avatarKey: string | null; contributionCount: number; firstContributionAt: string | null; createdAt: string }>(),
  ]);
  const avatar = (id: number, avatarKey: string | null) => {
    if (!avatarKey) return null;
    const version = avatarKey.split("/").at(-1) || avatarKey;
    return `/api/profile/avatar?id=${id}&v=${encodeURIComponent(version)}`;
  };
  return {
    period,
    day: targetDay,
    reading: reading.results.map((row) => ({ id: row.id, nickname: row.nickname, avatarUrl: avatar(row.id, row.avatarKey), readCount: Number(row.readCount || 0), readSeconds: Number(row.readSeconds || 0) })),
    contribution: contribution.results.map((row) => ({ id: row.id, nickname: row.nickname, avatarUrl: avatar(row.id, row.avatarKey), contributionCount: Number(row.contributionCount || 0) })),
  };
}

export async function syncSource(env: AppEnv, sourceId: number) {
  await ensureSchema(env.DB);
  const source = await env.DB.prepare("SELECT id, kind, name, url FROM sources WHERE id = ? AND enabled = 1").bind(sourceId).first<{ id: number; kind: string; name: string; url: string }>();
  if (!source) throw new Error("这个信息源不存在或已停用");
  if (source.kind !== "rss" && source.kind !== "x") throw new Error("微信公众号由本地采集器自动更新");
  const startedAt = now();
  const sync = await env.DB.prepare("INSERT INTO sync_runs (source_id, started_at) VALUES (?, ?)").bind(source.id, startedAt).run();
  try {
    let entries: FeedEntry[];
    let itemKind: "rss" | "link" | "x_article" = "rss";
    if (source.kind === "x") {
      const username = xSourceUsername(source.url);
      if (!username) throw new Error("X 订阅地址不完整");
      entries = await readXArticles(username);
      if (!entries.length) {
        const tweetUrl = "x-tweets://" + username.toLowerCase();
        const clash = await env.DB.prepare("SELECT id FROM sources WHERE url = ? AND id != ?").bind(tweetUrl, source.id).first<{ id: number }>();
        if (clash) {
          await env.DB.batch([
            env.DB.prepare("INSERT OR IGNORE INTO user_source_follows (user_id, source_id, created_at) SELECT user_id, ?, created_at FROM user_source_follows WHERE source_id = ?").bind(clash.id, source.id),
            env.DB.prepare("DELETE FROM user_source_follows WHERE source_id = ?").bind(source.id),
            env.DB.prepare("DELETE FROM sync_runs WHERE source_id = ?").bind(source.id),
            env.DB.prepare("DELETE FROM sources WHERE id = ?").bind(source.id),
          ]);
        } else {
          await env.DB.prepare("UPDATE sources SET kind = 'x-tweet', url = ?, last_synced_at = ?, last_error = NULL WHERE id = ?")
            .bind(tweetUrl, now(), source.id).run();
        }
        await env.DB.prepare("UPDATE sync_runs SET finished_at = ?, item_count = 0 WHERE id = ?").bind(now(), Number(sync.meta.last_row_id)).run();
        return 0;
      }
      itemKind = "x_article";
    } else {
      const { response, text: xml } = await fetchPublicText(source.url, { accept: FEED_ACCEPT, maxBytes: 1_500_000 });
      if (!response.ok) throw new Error(`来源返回 ${response.status}`);
      if (!isFeedDocument(xml)) throw new Error("这个地址不再返回 RSS 或 Atom 内容");
      entries = parseFeed(xml);
    }
    const added = await saveFeedEntries(env, source.id, entries, itemKind);
    if (source.kind === "x") await env.DB.prepare("DELETE FROM items WHERE source_id = ? AND kind = 'link'").bind(source.id).run();
    await env.DB.batch([
      env.DB.prepare("UPDATE sources SET last_synced_at = ?, last_error = NULL WHERE id = ?").bind(now(), source.id),
      env.DB.prepare("UPDATE sync_runs SET finished_at = ?, item_count = ? WHERE id = ?").bind(now(), added, Number(sync.meta.last_row_id)),
    ]);
    return added;
  } catch (error) {
    const message = error instanceof Error ? error.message : "同步失败";
    await env.DB.batch([
      env.DB.prepare("UPDATE sources SET last_error = ? WHERE id = ?").bind(message, source.id),
      env.DB.prepare("UPDATE sync_runs SET finished_at = ?, error = ? WHERE id = ?").bind(now(), message, Number(sync.meta.last_row_id)),
    ]);
    throw error;
  }
}

export async function syncSourcesByKind(env: AppEnv, kind: "rss" | "x") {
  await ensureSchema(env.DB);
  const rows = await env.DB.prepare("SELECT id FROM sources WHERE enabled = 1 AND kind = ? ORDER BY id LIMIT 30").bind(kind).all<{ id: number }>();
  const results = await Promise.allSettled(rows.results.map((row) => syncSource(env, row.id)));
  return results.filter((result) => result.status === "fulfilled").reduce((count, result) => count + (result as PromiseFulfilledResult<number>).value, 0);
}

// Sources without a custom interval keep the historical cadence: X hourly, RSS daily.
export async function syncDueSources(env: AppEnv) {
  await ensureSchema(env.DB);
  const rows = await env.DB.prepare(
    "SELECT id FROM sources WHERE enabled = 1 AND kind IN ('rss', 'x') AND (last_synced_at IS NULL OR julianday('now') - julianday(last_synced_at) >= COALESCE(sync_interval_minutes, CASE kind WHEN 'x' THEN 60 ELSE 1440 END) / 1440.0) ORDER BY last_synced_at IS NOT NULL, last_synced_at LIMIT 30",
  ).all<{ id: number }>();
  const results = await Promise.allSettled(rows.results.map((row) => syncSource(env, row.id)));
  return results.filter((result) => result.status === "fulfilled").reduce((count, result) => count + (result as PromiseFulfilledResult<number>).value, 0);
}

export async function syncAllSources(env: AppEnv) {
  const [rss, x] = await Promise.all([
    syncSourcesByKind(env, "rss"),
    syncSourcesByKind(env, "x"),
  ]);
  return rss + x;
}

type PendingItem = { id: number; title: string; originalExcerpt: string | null; language: string | null };

function aiText(result: unknown) {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const candidate = result as { response?: unknown; result?: { response?: unknown } };
    if (typeof candidate.response === "string") return candidate.response;
    if (typeof candidate.result?.response === "string") return candidate.result.response;
  }
  return "";
}

function parseAiJson(value: string) {
  const fenced = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 返回格式不完整");
  return JSON.parse(fenced.slice(start, end + 1)) as { title?: string; summary?: string; topic?: string };
}

export async function processPendingItems(env: AppEnv, limit = 6) {
  await ensureSchema(env.DB);
  const rows = await env.DB.prepare("SELECT id, title, original_excerpt AS originalExcerpt, language FROM items WHERE status = 'needs_ai' ORDER BY created_at DESC LIMIT ?")
    .bind(limit).all<PendingItem>();
  if (!rows.results.length) return { processed: 0, waiting: 0, aiAvailable: Boolean(env.AI) };

  let processed = 0;
  for (const item of rows.results) {
    const sourceText = `${item.title}\n${item.originalExcerpt || ""}`.trim();
    if (item.language === "zh" || /[\u4e00-\u9fff]/.test(sourceText.slice(0, 140))) {
      await env.DB.prepare("UPDATE items SET translated_title = title, translated_excerpt = COALESCE(original_excerpt, ''), topic = COALESCE(topic, '待归类'), status = 'ready' WHERE id = ?").bind(item.id).run();
      processed += 1;
      continue;
    }
    if (!env.AI) continue;

    try {
      const result = await env.AI.run("@cf/meta/llama-3.2-3b-instruct", {
        messages: [
          { role: "system", content: "你是个人情报助理。把输入准确翻译为简体中文，给出一句不夸张的摘要，并用 2-6 个汉字标注主题。只返回 JSON：{\"title\":\"\",\"summary\":\"\",\"topic\":\"\"}。" },
          { role: "user", content: sourceText.slice(0, 6000) },
        ],
        max_tokens: 700,
        temperature: 0.2,
      });
      const translated = parseAiJson(aiText(result));
      if (!translated.title || !translated.summary) throw new Error("AI 未返回完整翻译");
      await env.DB.prepare("UPDATE items SET translated_title = ?, translated_excerpt = ?, topic = ?, status = 'ready' WHERE id = ?")
        .bind(translated.title.trim(), translated.summary.trim(), translated.topic?.trim() || "待归类", item.id).run();
      processed += 1;
    } catch {
      // Leave the item queued so a later scheduled run can retry it.
    }
  }
  return { processed, waiting: rows.results.length - processed, aiAvailable: Boolean(env.AI) };
}

export async function generateIdea(env: AppEnv, userId: number) {
  await ensureSchema(env.DB);
  const rows = await env.DB.prepare("SELECT i.id, COALESCE(i.translated_title, i.title) AS title, i.topic FROM items i LEFT JOIN user_item_states uis ON uis.item_id = i.id AND uis.user_id = ? WHERE COALESCE(uis.is_saved, 0) = 1 OR i.status = 'ready' ORDER BY i.created_at DESC LIMIT 8").bind(userId).all<{ id: number; title: string; topic: string | null }>();
  if (rows.results.length < 2) throw new Error("至少收藏或处理两篇文章后，才能生成今日灵感");
  const titles = rows.results.slice(0, 3).map((item) => item.title);
  const headline = `把「${titles[0]}」写成一篇有判断的内容`;
  const angle = `不要复述新闻。用 ${titles.slice(1).join("、")} 作为对照：它们共同说明了什么变化？你的读者会因此改变哪个具体判断？`;
  await env.DB.prepare("INSERT INTO ideas (day, headline, angle, source_item_ids, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(day) DO UPDATE SET headline = excluded.headline, angle = excluded.angle, source_item_ids = excluded.source_item_ids, created_at = excluded.created_at").bind(day(), headline, angle, JSON.stringify(rows.results.slice(0, 3).map((item) => item.id)), now()).run();
}
