import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  account: text("account").notNull(),
  accountNormalized: text("account_normalized").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  passwordIterations: integer("password_iterations").notNull().default(100000),
  nickname: text("nickname").notNull(),
  bio: text("bio").notNull().default(""),
  avatarKey: text("avatar_key"),
  role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const authSessions = sqliteTable("auth_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
});

export const authAttempts = sqliteTable("auth_attempts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  attemptKey: text("attempt_key").notNull(),
  action: text("action", { enum: ["login", "register"] }).notNull(),
  succeeded: integer("succeeded", { mode: "boolean" }).notNull().default(false),
  attemptedAt: text("attempted_at").notNull(),
});

export const sources = sqliteTable("sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["rss", "wechat", "x"] }).notNull().default("rss"),
  category: text("category", { enum: ["ai", "investment", "gaming", "technology", "business", "product"] }),
  name: text("name").notNull(),
  url: text("url").notNull().unique(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastSyncedAt: text("last_synced_at"),
  lastError: text("last_error"),
  avatarUrl: text("avatar_url"),
  contributorUserId: integer("contributor_user_id").references(() => users.id),
  syncIntervalMinutes: integer("sync_interval_minutes"),
  createdAt: text("created_at").notNull(),
});

export const userSourceFollows = sqliteTable("user_source_follows", {
  userId: integer("user_id").notNull().references(() => users.id),
  sourceId: integer("source_id").notNull().references(() => sources.id),
  createdAt: text("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.sourceId] })]);

export const items = sqliteTable("items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceId: integer("source_id").references(() => sources.id),
  kind: text("kind", { enum: ["rss", "link"] }).notNull(),
  title: text("title").notNull(),
  originalExcerpt: text("original_excerpt"),
  contentMarkdown: text("content_markdown"),
  author: text("author"),
  translatedTitle: text("translated_title"),
  translatedExcerpt: text("translated_excerpt"),
  url: text("url").notNull().unique(),
  publishedAt: text("published_at"),
  language: text("language"),
  topic: text("topic"),
  status: text("status", { enum: ["pending", "ready", "needs_ai"] }).notNull().default("pending"),
  isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
  isSaved: integer("is_saved", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const syncRuns = sqliteTable("sync_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceId: integer("source_id").notNull().references(() => sources.id),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  itemCount: integer("item_count").notNull().default(0),
  error: text("error"),
});

export const apiTokens = sqliteTable("api_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at"),
});

export const contentStrategies = sqliteTable("content_strategies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  version: integer("version").notNull(),
  content: text("content").notNull(),
  note: text("note"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const retrospectives = sqliteTable("retrospectives", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  title: text("title").notNull(),
  problem: text("problem").notNull(),
  result: text("result").notNull(),
  lesson: text("lesson").notNull(),
  relatedSeries: text("related_series"),
  relatedTopicIds: text("related_topic_ids").notNull().default("[]"),
  version: integer("version").notNull().default(1),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  supersedesId: integer("supersedes_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const ideas = sqliteTable("ideas", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  day: text("day").notNull().unique(),
  headline: text("headline").notNull(),
  angle: text("angle").notNull(),
  sourceItemIds: text("source_item_ids").notNull(),
  createdAt: text("created_at").notNull(),
});
export const itches = sqliteTable("itches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  normalizedBody: text("normalized_body").notNull(),
  note: text("note"),
  status: text("status", { enum: ["open", "dormant", "resolved", "archived"] }).notNull().default("open"),
  feltCount: integer("felt_count").notNull().default(1),
  firstFeltAt: text("first_felt_at").notNull(),
  lastFeltAt: text("last_felt_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("itches_user_status_idx").on(table.userId, table.status, table.lastFeltAt),
  index("itches_user_normalized_idx").on(table.userId, table.normalizedBody),
]);

export const itchEvents = sqliteTable("itch_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itchId: integer("itch_id").notNull().references(() => itches.id),
  userId: integer("user_id").notNull().references(() => users.id),
  type: text("type", { enum: [
    "captured", "resurfaced", "note", "status_changed", "feedback",
    "exploration_created", "research_updated", "direction_created", "direction_status_changed",
  ] }).notNull(),
  body: text("body"),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("itch_events_itch_created_idx").on(table.itchId, table.createdAt)]);

export const itchLinks = sqliteTable("itch_links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itchId: integer("itch_id").notNull().references(() => itches.id),
  userId: integer("user_id").notNull().references(() => users.id),
  targetType: text("target_type", { enum: ["item", "annotation", "conversation", "project", "itch", "exploration", "direction", "topic"] }).notNull(),
  targetId: text("target_id").notNull(),
  relation: text("relation", { enum: ["triggered_by", "supports", "contradicts", "related_to", "derived_from", "tested_by", "spawned"] }).notNull(),
  note: text("note"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("itch_links_itch_idx").on(table.itchId, table.createdAt),
  uniqueIndex("itch_links_unique_idx").on(table.itchId, table.targetType, table.targetId, table.relation),
]);

export const explorations = sqliteTable("explorations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itchId: integer("itch_id").notNull().references(() => itches.id),
  userId: integer("user_id").notNull().references(() => users.id),
  round: integer("round").notNull(),
  status: text("status", { enum: ["open", "researching", "synthesized", "closed"] }).notNull().default("open"),
  triggerContext: text("trigger_context"),
  coreConflict: text("core_conflict"),
  personalStake: text("personal_stake"),
  desiredChange: text("desired_change"),
  questionTree: text("question_tree").notNull().default("[]"),
  materialMap: text("material_map").notNull().default("[]"),
  counterEvidence: text("counter_evidence").notNull().default("[]"),
  evidenceGaps: text("evidence_gaps").notNull().default("[]"),
  note: text("note"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("explorations_itch_round_idx").on(table.itchId, table.userId, table.round),
  index("explorations_user_updated_idx").on(table.userId, table.updatedAt),
]);

export const directions = sqliteTable("directions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itchId: integer("itch_id").notNull().references(() => itches.id),
  explorationId: integer("exploration_id").references(() => explorations.id),
  userId: integer("user_id").notNull().references(() => users.id),
  claim: text("claim").notNull(),
  audience: text("audience"),
  tension: text("tension"),
  personalConnection: text("personal_connection"),
  evidenceFor: text("evidence_for").notNull().default("[]"),
  evidenceAgainst: text("evidence_against").notNull().default("[]"),
  evidenceGaps: text("evidence_gaps").notNull().default("[]"),
  confidence: text("confidence", { enum: ["low", "medium", "high"] }).notNull().default("low"),
  status: text("status", { enum: ["candidate", "confirmed", "rejected", "retired"] }).notNull().default("candidate"),
  confirmationNote: text("confirmation_note"),
  confirmedAt: text("confirmed_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("directions_itch_status_idx").on(table.itchId, table.userId, table.status, table.updatedAt),
  index("directions_exploration_idx").on(table.explorationId),
]);

export const subscriptionRequests = sqliteTable("subscription_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  query: text("query").notNull().unique(),
  kind: text("kind", { enum: ["unknown", "wechat"] }).notNull().default("unknown"),
  category: text("category", { enum: ["ai", "investment", "gaming", "technology", "business", "product"] }),
  status: text("status", { enum: ["pending", "completed", "failed"] }).notNull().default("pending"),
  stage: text("stage", { enum: ["queued", "reading", "importing", "history", "retrying", "completed"] }).notNull().default("queued"),
  resultName: text("result_name"),
  itemCount: integer("item_count").notNull().default(0),
  requesterUserId: integer("requester_user_id").references(() => users.id),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
});

export const userItemStates = sqliteTable("user_item_states", {
  userId: integer("user_id").notNull().references(() => users.id),
  itemId: integer("item_id").notNull().references(() => items.id),
  isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
  readAt: text("read_at"),
  isSaved: integer("is_saved", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.itemId] })]);

export const dailyReadingActivity = sqliteTable("daily_reading_activity", {
  userId: integer("user_id").notNull().references(() => users.id),
  itemId: integer("item_id").notNull().references(() => items.id),
  day: text("day").notNull(),
  activeSeconds: integer("active_seconds").notNull().default(0),
  lastHeartbeatAt: text("last_heartbeat_at").notNull(),
  countedAt: text("counted_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.itemId, table.day] })]);

export const annotations = sqliteTable("annotations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: integer("item_id").notNull().references(() => items.id),
  userId: integer("user_id").notNull().references(() => users.id),
  quote: text("quote").notNull(),
  body: text("body").notNull(),
  blockIndex: integer("block_index").notNull(),
  startOffset: integer("start_offset").notNull(),
  endOffset: integer("end_offset").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const annotationReplies = sqliteTable("annotation_replies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  annotationId: integer("annotation_id").notNull().references(() => annotations.id),
  userId: integer("user_id").notNull().references(() => users.id),
  replyToUserId: integer("reply_to_user_id").references(() => users.id),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const profileLikes = sqliteTable("profile_likes", {
  userId: integer("user_id").notNull().references(() => users.id),
  profileUserId: integer("profile_user_id").notNull().references(() => users.id),
  createdAt: text("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.profileUserId] })]);

export const profileMessages = sqliteTable("profile_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  profileUserId: integer("profile_user_id").notNull().references(() => users.id),
  authorUserId: integer("author_user_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  actorUserId: integer("actor_user_id").notNull().references(() => users.id),
  type: text("type", { enum: ["annotation_reply", "profile_message", "profile_like"] }).notNull(),
  annotationId: integer("annotation_id").references(() => annotations.id),
  profileMessageId: integer("profile_message_id").references(() => profileMessages.id),
  isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});
