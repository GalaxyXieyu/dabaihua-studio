import { ensureSchema } from "./store";

type Env = { DB: D1Database };

const now = () => new Date().toISOString();

export const DEFAULT_PROFILE = {
  model: "gpt-5.4-mini",
  keywords: ["agent", "llm", "rag", "claude", "gpt", "gemini", "mcp", "cursor", "copilot", "vibe", "workflow",
    "多模态", "大模型", "智能体", "微调", "检索", "提示词", "aigc", "生图", "编程", "开发", "工程", "评测", "开源"],
  prompt: `## 我的内容方向
- AI Agent 工程化（LangGraph、多Agent协作、Harness框架）
- AIGC 工具使用（生图、设计工作流）
- AI 编程工作流（VibeCoding、Cursor、Claude Code）
- AI 产品评测与分析

## 评分标准（各 0-3 分）
- 热度：0=无人关注 1=小圈子 2=平台热点 3=全网热搜
- 匹配度：0=跑题 1=沾边 2=相关 3=正中我的方向
- 可执行性：0=需大量调研 1=需2天以上 2=一天内可出 3=现成素材直接出

## HKR 预判
H=Hook（标题能让人想点开吗）K=Knowledge（有信息增量吗）R=Resonance（能戳中情绪/共鸣吗）

## 产出要求
若值得做（总分≥6），给出：具体可执行的选题标题（不是原文标题）、1-2 个切入角度、推荐平台（公众号/小红书/B站/X 选一）、内容类型（连载/工具/热点/产品 选一）、一句话理由。`,
};

export async function getActiveProfile(env: Env) {
  await ensureSchema(env.DB);
  const row = await env.DB.prepare("SELECT id, version, content, note, created_at AS createdAt FROM eval_profiles WHERE is_active = 1 ORDER BY id DESC LIMIT 1").first<Record<string, unknown>>();
  if (row) return row;
  const content = JSON.stringify(DEFAULT_PROFILE);
  await env.DB.prepare("INSERT INTO eval_profiles (version, content, note, is_active, created_at) VALUES (1, ?, '初始版本', 1, ?)").bind(content, now()).run();
  return { id: 1, version: 1, content, note: "初始版本", createdAt: now() };
}

export async function saveProfile(env: Env, content: string, note: string) {
  await ensureSchema(env.DB);
  JSON.parse(content);
  const max = await env.DB.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM eval_profiles").first<{ v: number }>();
  const version = Number(max?.v || 0) + 1;
  await env.DB.batch([
    env.DB.prepare("UPDATE eval_profiles SET is_active = 0"),
    env.DB.prepare("INSERT INTO eval_profiles (version, content, note, is_active, created_at) VALUES (?, ?, ?, 1, ?)").bind(version, content, (note || "").slice(0, 200), now()),
  ]);
  return { version };
}

export async function listProfiles(env: Env) {
  await ensureSchema(env.DB);
  const rows = await env.DB.prepare("SELECT id, version, note, is_active AS isActive, created_at AS createdAt FROM eval_profiles ORDER BY version DESC LIMIT 30").all();
  return rows.results;
}

export async function listUnevaluated(env: Env, limit: number) {
  await ensureSchema(env.DB);
  const rows = await env.DB.prepare(`SELECT i.id, i.kind, i.title, i.author, i.original_excerpt AS excerpt,
      substr(COALESCE(i.content_markdown, i.original_excerpt, ''), 1, 3000) AS content,
      i.url, i.published_at AS publishedAt, s.name AS sourceName
    FROM items i LEFT JOIN item_evaluations e ON e.item_id = i.id LEFT JOIN sources s ON s.id = i.source_id
    WHERE e.item_id IS NULL ORDER BY i.id DESC LIMIT ?`).bind(Math.min(Math.max(limit, 1), 100)).all();
  return rows.results;
}

type EvalPayload = {
  itemId: number; heat: number; match: number; feasibility: number; verdict: string; hkr?: string; model?: string;
  title?: string; angle?: string; reason?: string; platform?: string; contentType?: string;
};

export async function recordEvaluation(env: Env, e: EvalPayload) {
  await ensureSchema(env.DB);
  const total = Number(e.heat || 0) + Number(e.match || 0) + Number(e.feasibility || 0);
  await env.DB.prepare(`INSERT INTO item_evaluations (item_id, heat, match_score, feasibility, total, verdict, hkr, model, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(item_id) DO UPDATE SET heat=excluded.heat, match_score=excluded.match_score,
      feasibility=excluded.feasibility, total=excluded.total, verdict=excluded.verdict, hkr=excluded.hkr, model=excluded.model`)
    .bind(e.itemId, e.heat || 0, e.match || 0, e.feasibility || 0, total, e.verdict, e.hkr || "", e.model || "", now()).run();
  if (total >= 6 && e.verdict === "ok" && e.title && e.angle) {
    await env.DB.prepare(`INSERT INTO topics (title, angle, reason, platform, content_type, heat, match_score, feasibility, total, hkr, status, item_ids, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?, ?, ?)`)
      .bind(e.title.slice(0, 120), e.angle.slice(0, 500), (e.reason || "").slice(0, 300), e.platform || "", e.contentType || "",
        e.heat || 0, e.match || 0, e.feasibility || 0, total, e.hkr || "", JSON.stringify([e.itemId]), now(), now()).run();
    return { total, topicCreated: true };
  }
  return { total, topicCreated: false };
}

export async function listTopics(env: Env, status: string) {
  await ensureSchema(env.DB);
  const rows = await env.DB.prepare(`SELECT id, title, angle, reason, platform, content_type AS contentType, heat,
      match_score AS matchScore, feasibility, total, hkr, status, item_ids AS itemIds, created_at AS createdAt, updated_at AS updatedAt,
      draft_updated_at AS draftUpdatedAt,
      review_status AS reviewStatus, review_comment AS reviewComment, reviewed_at AS reviewedAt,
      publish_status AS publishStatus, publish_html_at AS publishHtmlAt, wechat_draft_saved_at AS wechatDraftSavedAt,
      CASE WHEN draft_markdown IS NOT NULL AND draft_markdown != '' THEN 1 ELSE 0 END AS hasDraft
    FROM topics WHERE (? = '' OR status = ?) ORDER BY total DESC, id DESC LIMIT 100`).bind(status, status).all();
  return rows.results;
}

export async function getTopic(env: Env, id: number) {
  await ensureSchema(env.DB);
  const row = await env.DB.prepare(`SELECT id, title, angle, reason, platform, content_type AS contentType, heat,
      match_score AS matchScore, feasibility, total, hkr, status, item_ids AS itemIds, created_at AS createdAt, updated_at AS updatedAt,
      draft_updated_at AS draftUpdatedAt,
      review_status AS reviewStatus, review_comment AS reviewComment, reviewed_at AS reviewedAt,
      publish_status AS publishStatus, publish_html_at AS publishHtmlAt, wechat_draft_saved_at AS wechatDraftSavedAt,
      CASE WHEN draft_markdown IS NOT NULL AND draft_markdown != '' THEN 1 ELSE 0 END AS hasDraft,
      draft_markdown AS draftMarkdown
    FROM topics WHERE id = ?`).bind(id).first();
  return row || null;
}

export async function setTopicStatus(env: Env, id: number, status: string) {
  await ensureSchema(env.DB);
  if (!["candidate", "approved", "skipped"].includes(status)) throw new Error("状态不合法");
  await env.DB.prepare("UPDATE topics SET status = ?, updated_at = ? WHERE id = ?").bind(status, now(), id).run();
}

export async function importTweets(env: Env, author: string, handle: string,
  tweets: Array<{ url: string; text: string; publishedAt?: string; heat?: string }>) {
  await ensureSchema(env.DB);
  const sourceUrl = "x-tweets://" + (handle || author).toLowerCase();
  let source = await env.DB.prepare("SELECT id FROM sources WHERE url = ?").bind(sourceUrl).first<{ id: number }>();
  if (!source) {
    await env.DB.prepare("INSERT INTO sources (kind, category, name, url, enabled, created_at) VALUES ('x-tweet', 'ai', ?, ?, 1, ?)")
      .bind((author || handle) + "·推文", sourceUrl, now()).run();
    source = await env.DB.prepare("SELECT id FROM sources WHERE url = ?").bind(sourceUrl).first<{ id: number }>();
  }
  let added = 0;
  for (const t of tweets || []) {
    if (!t.url || !t.text) continue;
    const title = t.text.split("\n")[0].slice(0, 120) || "(推文)";
    const body = t.text + (t.heat ? "\n\n> 互动: " + t.heat : "");
    const result = await env.DB.prepare(`INSERT OR IGNORE INTO items (source_id, kind, title, original_excerpt, content_markdown, author, url, published_at, language, status, created_at)
        VALUES (?, 'tweet', ?, ?, ?, ?, ?, ?, 'auto', 'ready', ?)`)
      .bind(source!.id, title, t.text.slice(0, 500), body, author || handle, t.url, t.publishedAt || null, now()).run();
    if (result.meta.changes > 0) added += 1;
  }
  await env.DB.prepare("UPDATE sources SET last_synced_at = ? WHERE id = ?").bind(now(), source!.id).run();
  return added;
}

// ─── 内容策略管理（D-05 版本化）────────────────────────

const DEFAULT_STRATEGY = {
  platforms: {
    wechat_gzh: {
      positioning: "搜索长尾资产+深度沉淀",
      content_routing: {
        "工具教程": { allowed: true, rule: "完整步骤+亲测+标题含搜索词" },
        "实战踩坑": { allowed: true, rule: "有项目有截图，读者能直接复用" },
        "判断型": { allowed: true, rule: "强立场+比较，不模棱两可" },
        "热点借势": { allowed: "conditional", rule: "48小时内+亲测角度，缺一不可" },
        "纯新闻转述": { allowed: false, reason: "量子位更快更全" },
        "纯方法论": { allowed: false, reason: "无搜索词，无留存价值" },
      },
      title_formulas: {
        "工具教程": "[工具]实战：怎么[做XX]",
        "实战踩坑": "用了[时间][工具]，这几个坑要注意",
        "判断型": "为什么[我/你]选[X]而不是[Y]",
        "热点借势": "[工具]我测了[时间]，说几个真实体验",
      },
      publish_rules: ["单日≤1篇", "热点≤48小时", "系列必须有第0篇大纲+footer导航"],
    },
    xiaohongshu: {
      positioning: "算法推流+收藏传播",
      key_metric: "收藏/点赞比≥1.5x",
      content_routing: {
        "可视化图表": { heat: 3155, allowed: true, rule: "AI生图/架构图/PPT配图，秀成果优先" },
        "数据分析": { heat: 801, allowed: true, rule: "反常识开头+情绪收尾" },
        "Agent成果": { heat: 312, allowed: true, rule: "必须有成果图/GIF" },
        "AI编程教程": { heat: 165, allowed: "conditional", rule: "必须配视频或操作图" },
        "模型资讯": { heat: 128, allowed: false, reason: "XHS用户不看新闻" },
      },
      title_formulas: {
        structure: "[emoji][数字][痛点/结果]",
        required_two_of_three: ["emoji在最前", "数字", "痛点或结果"],
        blacklist: ["分享", "介绍", "简单聊聊", "浅谈", "全面", "深度", "一文读懂", "教程", "入门到精通"],
      },
    },
  },
  topic_routing_matrix: {
    "工具完整教程": { GZH: "主发长文", XHS: "有配图才做摘要版" },
    "可视化成果": { GZH: "可选", XHS: "主发，视频优先" },
    "职业洞察": { GZH: "深度分析版", XHS: "情绪版反常识开头" },
    "AI热点": { GZH: "有亲测才做", XHS: "不做" },
    "LangGraph实战": { GZH: "连载教程", XHS: "成果展示版" },
  },
  banned_patterns: {
    words: ["说白了", "意味着", "本质上", "换句话说", "不可否认", "综上所述", "总的来说", "值得注意的是", "不难发现", "显而易见", "让我们来看看", "随着AI技术的发展", "希望对大家有所帮助", "如有不足欢迎指正", "具有重要意义", "不说废话直接上干货"],
    punctuation: { "冒号": "改用逗号或重构", "破折号": "改用逗号句号", "双引号": "改用「」或不加" },
    structures: ["连续bullet>3个", "每段都有加粗小标题", "优点是A缺点是B的假平衡"],
    vague_refs: ["AI工具→写具体名", "某个模型→写具体名", "相关技术→说清楚"],
  },
  derivation_order: ["master", "video_script", "gzh_version", "xhs_version", "x_thread"],
  cta_templates: {
    gzh_private: "想深入交流这个话题，欢迎加我微信：[微信号]",
    gzh_follow: "更多实战内容，关注这个公众号，每周更新",
    xhs_collect: "收藏这篇，下次用到直接翻",
    xhs_comment: "你也遇到过这个问题吗？评论区聊聊👇",
  },
};

export async function getActiveStrategy(env: Env) {
  await ensureSchema(env.DB);
  const row = await env.DB.prepare("SELECT id, version, content, note, created_at AS createdAt FROM content_strategies WHERE is_active = 1 ORDER BY id DESC LIMIT 1").first<Record<string, unknown>>();
  if (row) return row;
  const content = JSON.stringify(DEFAULT_STRATEGY);
  await env.DB.prepare("INSERT INTO content_strategies (version, content, note, is_active, created_at) VALUES (1, ?, '初始版本(从本地内容策略.md迁移)', 1, ?)").bind(content, now()).run();
  return { id: 1, version: 1, content, note: "初始版本", createdAt: now() };
}

export async function saveStrategy(env: Env, content: string, note: string) {
  await ensureSchema(env.DB);
  JSON.parse(content); // D-17：仅合法性校验，不严格 schema
  const max = await env.DB.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM content_strategies").first<{ v: number }>();
  const version = Number(max?.v || 0) + 1;
  await env.DB.batch([
    env.DB.prepare("UPDATE content_strategies SET is_active = 0"),
    env.DB.prepare("INSERT INTO content_strategies (version, content, note, is_active, created_at) VALUES (?, ?, ?, 1, ?)").bind(version, content, (note || "").slice(0, 200), now()),
  ]);
  return { version };
}

export async function listStrategyVersions(env: Env) {
  await ensureSchema(env.DB);
  const rows = await env.DB.prepare("SELECT id, version, note, is_active AS isActive, created_at AS createdAt FROM content_strategies ORDER BY version DESC LIMIT 30").all();
  return rows.results;
}

export async function activateStrategyVersion(env: Env, version: number) {
  await ensureSchema(env.DB);
  const target = await env.DB.prepare("SELECT id FROM content_strategies WHERE version = ?").bind(version).first();
  if (!target) throw new Error("版本不存在");
  await env.DB.batch([
    env.DB.prepare("UPDATE content_strategies SET is_active = 0"),
    env.DB.prepare("UPDATE content_strategies SET is_active = 1 WHERE version = ?").bind(version),
  ]);
}

// ─── 选题扩展管理（D-06/D-07/D-08）─────────────────────

type TopicUpdateInput = {
  title?: string; angle?: string; reason?: string;
  platform?: string; contentType?: string;
  series?: string; seriesOrder?: number;
  scheduledDate?: string | null; notes?: string;
  platformDetail?: string; status?: "candidate" | "approved" | "skipped" | "scheduled" | "published";
};

export async function updateTopic(env: Env, id: number, input: TopicUpdateInput) {
  await ensureSchema(env.DB);
  const topic = await env.DB.prepare("SELECT id FROM topics WHERE id = ?").bind(id).first();
  if (!topic) throw new Error("选题不存在");
  const sets: string[] = [];
  const binds: unknown[] = [];
  const fieldMap: Record<string, string> = {
    title: "title", angle: "angle", reason: "reason",
    platform: "platform", contentType: "content_type",
    series: "series", seriesOrder: "series_order",
    scheduledDate: "scheduled_date", notes: "notes",
    platformDetail: "platform_detail", status: "status",
  };
  for (const [key, col] of Object.entries(fieldMap)) {
    const v = (input as Record<string, unknown>)[key];
    if (v !== undefined) { sets.push(`${col} = ?`); binds.push(v); }
  }
  if (input.status === "scheduled" && !input.scheduledDate) {
    throw new Error("排期状态必须提供 scheduled_date");
  }
  if (!sets.length) return;
  sets.push("updated_at = ?"); binds.push(now());
  binds.push(id);
  await env.DB.prepare(`UPDATE topics SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();
}

export async function publishTopic(env: Env, id: number, input: {
  url: string; publishedDate?: string;
  reads?: number; likes?: number; collects?: number; shares?: number;
}) {
  await ensureSchema(env.DB);
  const topic = await env.DB.prepare("SELECT id FROM topics WHERE id = ?").bind(id).first();
  if (!topic) throw new Error("选题不存在");
  const metrics = {
    reads: input.reads ?? 0, likes: input.likes ?? 0,
    collects: input.collects ?? 0, shares: input.shares ?? 0,
  };
  await env.DB.prepare("UPDATE topics SET status = 'published', published_url = ?, published_date = ?, metrics = ?, updated_at = ? WHERE id = ?")
    .bind(input.url, input.publishedDate || now().slice(0, 10), JSON.stringify(metrics), now(), id).run();
}

export async function checkScheduleConflict(env: Env, date: string, excludeId: number): Promise<string | null> {
  await ensureSchema(env.DB);
  const conflict = await env.DB.prepare(
    "SELECT id, title FROM topics WHERE scheduled_date = ? AND platform IN ('gzh', 'wechat_gzh') AND status = 'scheduled' AND id != ?"
  ).bind(date, excludeId).first<{ id: number; title: string }>();
  return conflict ? conflict.title : null;
}

export async function listSeries(env: Env) {
  await ensureSchema(env.DB);
  const rows = await env.DB.prepare(
    "SELECT series, COUNT(*) AS count, MIN(series_order) AS minOrder, MAX(series_order) AS maxOrder FROM topics WHERE series IS NOT NULL AND series != '' GROUP BY series ORDER BY count DESC"
  ).all();
  return rows.results;
}

export async function listSeriesTopics(env: Env, seriesName: string) {
  await ensureSchema(env.DB);
  const rows = await env.DB.prepare(
    "SELECT id, title, angle, platform, status, series_order AS seriesOrder, scheduled_date AS scheduledDate, published_date AS publishedDate, published_url AS publishedUrl FROM topics WHERE series = ? ORDER BY series_order ASC, id ASC"
  ).bind(seriesName).all();
  return rows.results;
}

export async function listScheduledTopics(env: Env, fromDate: string, toDate: string) {
  await ensureSchema(env.DB);
  const rows = await env.DB.prepare(
    "SELECT id, title, platform, series, scheduled_date AS scheduledDate, status FROM topics WHERE scheduled_date BETWEEN ? AND ? ORDER BY scheduled_date ASC, id ASC"
  ).bind(fromDate, toDate).all();
  return rows.results;
}

// ─── 复盘记录管理（D-18 单独建表 + 版本管理）──────────────

type RetrospectiveInput = {
  date: string; title: string; problem: string; result: string; lesson: string;
  relatedSeries?: string; relatedTopicIds?: number[];
};

export async function listRetrospectives(env: Env, includeHistory = false) {
  await ensureSchema(env.DB);
  const where = includeHistory ? "" : "WHERE is_active = 1";
  const rows = await env.DB.prepare(
    `SELECT id, date, title, problem, result, lesson, related_series AS relatedSeries,
            related_topic_ids AS relatedTopicIds, version, is_active AS isActive,
            supersedes_id AS supersedesId, created_at AS createdAt, updated_at AS updatedAt
     FROM retrospectives ${where} ORDER BY date DESC, id DESC LIMIT 100`
  ).all();
  return rows.results;
}

export async function createRetrospective(env: Env, input: RetrospectiveInput) {
  await ensureSchema(env.DB);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("日期格式应为 YYYY-MM-DD");
  if (!input.title.trim()) throw new Error("标题不能为空");
  const ts = now();
  const inserted = await env.DB.prepare(
    `INSERT INTO retrospectives (date, title, problem, result, lesson, related_series, related_topic_ids, version, is_active, supersedes_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, NULL, ?, ?)`
  ).bind(input.date, input.title.trim(), input.problem, input.result, input.lesson,
    input.relatedSeries || null, JSON.stringify(input.relatedTopicIds || []), ts, ts).run();
  return { id: Number(inserted.meta.last_row_id), version: 1 };
}

export async function reviseRetrospective(env: Env, id: number, input: Partial<RetrospectiveInput>) {
  await ensureSchema(env.DB);
  const old = await env.DB.prepare("SELECT * FROM retrospectives WHERE id = ? AND is_active = 1").bind(id).first<Record<string, unknown>>();
  if (!old) throw new Error("复盘不存在或已是历史版本");
  const ts = now();
  const newVersion = Number(old.version) + 1;
  const merged = {
    date: input.date ?? String(old.date),
    title: input.title ?? String(old.title),
    problem: input.problem ?? String(old.problem),
    result: input.result ?? String(old.result),
    lesson: input.lesson ?? String(old.lesson),
    related_series: input.relatedSeries !== undefined ? input.relatedSeries : old.related_series,
    related_topic_ids: input.relatedTopicIds !== undefined ? JSON.stringify(input.relatedTopicIds) : old.related_topic_ids,
  };
  await env.DB.batch([
    env.DB.prepare("UPDATE retrospectives SET is_active = 0, updated_at = ? WHERE id = ?").bind(ts, id),
    env.DB.prepare(
      `INSERT INTO retrospectives (date, title, problem, result, lesson, related_series, related_topic_ids, version, is_active, supersedes_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
    ).bind(merged.date, merged.title, merged.problem, merged.result, merged.lesson,
      merged.related_series, merged.related_topic_ids, newVersion, id, ts, ts),
  ]);
  return { version: newVersion };
}

export async function getRetrospectiveHistory(env: Env, title: string) {
  await ensureSchema(env.DB);
  const rows = await env.DB.prepare(
    `SELECT id, version, is_active AS isActive, supersedes_id AS supersedesId,
            problem, result, lesson, created_at AS createdAt, updated_at AS updatedAt
     FROM retrospectives WHERE title = ? ORDER BY version DESC`
  ).bind(title).all();
  return rows.results;
}
