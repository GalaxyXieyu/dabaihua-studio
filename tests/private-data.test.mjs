/**
 * Tests for the /daily and /career private datasets: validation, the pure D1
 * write orchestration, the authentication decision helper, and the static
 * "no build-time glob" guarantees.
 *
 * All data here is made up; no real daily/career content or account names.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  DATASET_LIMITS,
  canonicalJson,
  decideDatasetAuth,
  handleDatasetPut,
  loadDataset,
  readDatasetMeta,
  validateCareerData,
  validateDailyData,
} from "../lib/private-data.ts";
import { createFakeD1 } from "./helpers/fake-d1.mjs";

const SCHEMA = `CREATE TABLE IF NOT EXISTS private_datasets (
  name TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  generated_at TEXT,
  summary_json TEXT NOT NULL DEFAULT '{}',
  uploaded_at TEXT NOT NULL,
  uploaded_by TEXT
)`;

function setup() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(SCHEMA);
  return { db: createFakeD1(sqlite), sqlite };
}

function dailyData(overrides = {}) {
  return {
    generatedAt: "2026-10-02T10:00:00.000Z",
    days: [
      { date: "2026-10-01", summary: "样例一", sections: {}, repos: [], repoStats: [], commits: 1, tokensM: null },
      { date: "2026-10-02", summary: "样例二", sections: {}, repos: ["app"], repoStats: [], commits: 2, tokensM: 1.5 },
    ],
    ...overrides,
  };
}

function careerData(overrides = {}) {
  return {
    schema_version: 1,
    generated_at: "2026-10-02T00:00:00.000Z",
    header: { data_as_of: "2026-10-02" },
    jobs: [{ no: 1 }, { no: 2 }],
    results: [{ id: "r1" }],
    missing: { total: 0, top: [], rest: [] },
    pending: [],
    ...overrides,
  };
}

// ── validation ──────────────────────────────────────────────────────────────

test("validateDailyData accepts a minimal made-up payload", () => {
  const result = validateDailyData(dailyData());
  assert.equal(result.ok, true);
  assert.deepEqual(result.summary, { days: 2, first: "2026-10-01", last: "2026-10-02" });
});

test("validateDailyData rejects malformed payloads", () => {
  assert.equal(validateDailyData(null).ok, false);
  assert.equal(validateDailyData([]).ok, false);
  assert.equal(validateDailyData({ days: [] }).ok, false);
  assert.equal(validateDailyData(dailyData({ days: {} })).ok, false);

  const badDate = dailyData({ days: [{ date: "2026/10/01", summary: "", sections: {}, repos: [], repoStats: [], commits: null, tokensM: null }] });
  assert.equal(validateDailyData(badDate).ok, false);

  const duplicated = dailyData({
    days: [
      { date: "2026-10-01", summary: "", sections: {}, repos: [], repoStats: [], commits: null, tokensM: null },
      { date: "2026-10-01", summary: "", sections: {}, repos: [], repoStats: [], commits: null, tokensM: null },
    ],
  });
  assert.match(validateDailyData(duplicated).error, /日期重复/);

  const badCommits = dailyData({ days: [{ date: "2026-10-01", summary: "", sections: {}, repos: [], repoStats: [], commits: "1", tokensM: null }] });
  assert.equal(validateDailyData(badCommits).ok, false);

  const tooMany = dailyData({ days: Array.from({ length: 4001 }, () => ({ date: "2026-10-01" })) });
  assert.equal(validateDailyData(tooMany).ok, false);
});

test("validateCareerData accepts the fixed shape and rejects drift", () => {
  const result = validateCareerData(careerData());
  assert.equal(result.ok, true);
  assert.deepEqual(result.summary, { jobs: 2, results: 1 });

  assert.equal(validateCareerData(null).ok, false);
  assert.equal(validateCareerData(careerData({ schema_version: 2 })).ok, false);
  assert.equal(validateCareerData(careerData({ generated_at: "" })).ok, false);
  assert.equal(validateCareerData(careerData({ header: [] })).ok, false);
  assert.equal(validateCareerData(careerData({ jobs: {} })).ok, false);
  assert.equal(validateCareerData(careerData({ results: {} })).ok, false);
  assert.equal(validateCareerData(careerData({ missing: [] })).ok, false);
  assert.equal(validateCareerData(careerData({ pending: {} })).ok, false);
});

test("canonicalJson is plain JSON.stringify", () => {
  const value = { b: 1, a: [2, 3] };
  assert.equal(canonicalJson(value), JSON.stringify(value));
});

// ── handleDatasetPut ────────────────────────────────────────────────────────

test("handleDatasetPut creates, dedupes by sha256, then updates", async () => {
  const { db, sqlite } = setup();
  const now = "2026-10-02T12:00:00.000Z";
  const body = JSON.stringify(dailyData());

  const created = await handleDatasetPut({ db, name: "daily", rawBody: body, actor: "样例管理员", now });
  assert.equal(created.status, 200);
  assert.equal(created.body.status, "updated");
  assert.equal(created.body.name, "daily");
  assert.equal(created.body.generatedAt, "2026-10-02T10:00:00.000Z");
  assert.deepEqual(created.body.summary, { days: 2, first: "2026-10-01", last: "2026-10-02" });
  assert.equal(typeof created.body.sha256, "string");
  assert.match(created.body.sha256, /^[a-f0-9]{64}$/);
  const row = sqlite.prepare("SELECT json, uploaded_by FROM private_datasets WHERE name = ?").get("daily");
  assert.equal(row.uploaded_by, "样例管理员");
  assert.equal(row.json, JSON.stringify(dailyData()));

  const unchanged = await handleDatasetPut({ db, name: "daily", rawBody: JSON.stringify(dailyData()), actor: "样例管理员", now: "2026-10-03T00:00:00.000Z" });
  assert.equal(unchanged.status, 200);
  assert.equal(unchanged.body.status, "unchanged");
  assert.equal(unchanged.body.uploadedAt, now);

  const changed = await handleDatasetPut({
    db,
    name: "daily",
    rawBody: JSON.stringify((() => {
      const edited = dailyData({ generatedAt: "2026-10-03T00:00:00.000Z" });
      edited.days[0].summary += "（改过）";
      return edited;
    })()),
    actor: "样例管理员",
    now: "2026-10-03T01:00:00.000Z",
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.status, "updated");
  assert.equal(changed.body.uploadedAt, "2026-10-03T01:00:00.000Z");
});

test("handleDatasetPut rejects unknown names, bad sizes, bad JSON and bad shapes", async () => {
  const { db } = setup();

  const unknown = await handleDatasetPut({ db, name: "other", rawBody: "{}", actor: "a", now: "t" });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.code, "unknown_dataset");

  const tooLarge = await handleDatasetPut({
    db,
    name: "daily",
    rawBody: "x".repeat(DATASET_LIMITS.daily + 1),
    actor: "a",
    now: "t",
  });
  assert.equal(tooLarge.status, 413);
  assert.equal(tooLarge.body.code, "too_large");

  const badJson = await handleDatasetPut({ db, name: "daily", rawBody: "{not json", actor: "a", now: "t" });
  assert.equal(badJson.status, 400);
  assert.equal(badJson.body.code, "invalid_json");

  const badShape = await handleDatasetPut({ db, name: "daily", rawBody: JSON.stringify({ generatedAt: "x", days: "no" }), actor: "a", now: "t" });
  assert.equal(badShape.status, 422);
  assert.equal(badShape.body.code, "invalid_data");
  assert.match(badShape.body.error, /days/);

  const careerBad = await handleDatasetPut({ db, name: "career", rawBody: JSON.stringify({ schema_version: 1 }), actor: "a", now: "t" });
  assert.equal(careerBad.status, 422);
});

test("readDatasetMeta and loadDataset round-trip a career payload", async () => {
  const { db } = setup();
  await handleDatasetPut({ db, name: "career", rawBody: JSON.stringify(careerData()), actor: "import-token", now: "2026-10-02T00:00:00.000Z" });

  const meta = await readDatasetMeta(db, "career");
  assert.equal(meta.name, "career");
  assert.equal(meta.generatedAt, "2026-10-02T00:00:00.000Z");
  assert.equal(meta.uploadedBy, "import-token");
  assert.deepEqual(meta.summary, { jobs: 2, results: 1 });

  const loaded = await loadDataset(db, "career");
  assert.equal(loaded.schema_version, 1);
  assert.equal(loaded.jobs.length, 2);

  assert.equal(await readDatasetMeta(db, "daily"), null);
  assert.equal(await loadDataset(db, "daily"), null);
});

test("loadDataset returns null for unparsable stored json", async () => {
  const { db, sqlite } = setup();
  sqlite.prepare("INSERT INTO private_datasets (name, json, sha256, bytes, uploaded_at) VALUES (?, ?, ?, ?, ?)").run("daily", "{oops", "x", 1, "t");
  assert.equal(await loadDataset(db, "daily"), null);
});

// ── decideDatasetAuth ───────────────────────────────────────────────────────

test("decideDatasetAuth: import token first, then admin key, then admin session", () => {
  const base = { apiKeyUser: null, sessionUser: null, sameOrigin: true, method: "PUT" };

  const ok = decideDatasetAuth({ ...base, importToken: "secret", providedToken: "secret" });
  assert.deepEqual(ok, { ok: true, actor: "import-token" });

  const wrong = decideDatasetAuth({ ...base, importToken: "secret", providedToken: "nope" });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.status, 401);
  assert.equal(wrong.code, "unauthorized");

  // 未配置 IMPORT_TOKEN 时任何 header 都不匹配。
  const emptyExpected = decideDatasetAuth({ ...base, importToken: "", providedToken: "secret" });
  assert.equal(emptyExpected.ok, false);
  assert.equal(emptyExpected.status, 401);
  assert.equal(decideDatasetAuth({ ...base, importToken: undefined, providedToken: "" }).ok, false);

  const adminKey = decideDatasetAuth({ ...base, apiKeyUser: { account: "yu", role: "admin" } });
  assert.deepEqual(adminKey, { ok: true, actor: "yu" });

  const userKey = decideDatasetAuth({ ...base, apiKeyUser: { account: "reader", role: "user" } });
  assert.equal(userKey.ok, false);
  assert.equal(userKey.status, 403);

  const sessionNoOrigin = decideDatasetAuth({ ...base, sessionUser: { account: "yu", role: "admin" }, sameOrigin: false });
  assert.equal(sessionNoOrigin.ok, false);
  assert.equal(sessionNoOrigin.status, 403);

  const sessionPut = decideDatasetAuth({ ...base, sessionUser: { account: "yu", role: "admin" }, sameOrigin: true });
  assert.deepEqual(sessionPut, { ok: true, actor: "yu" });

  // GET 不要求同源。
  const sessionGet = decideDatasetAuth({ ...base, method: "GET", sessionUser: { account: "yu", role: "admin" }, sameOrigin: false });
  assert.deepEqual(sessionGet, { ok: true, actor: "yu" });

  const userSession = decideDatasetAuth({ ...base, sessionUser: { account: "reader", role: "user" } });
  assert.equal(userSession.status, 403);

  const none = decideDatasetAuth({ ...base });
  assert.equal(none.ok, false);
  assert.equal(none.status, 401);
});

// ── static build-time guarantees ────────────────────────────────────────────

test("daily/career loaders read D1 and never glob at build time", async () => {
  const [dailyDataFile, careerDataFile, dailyPage, careerPage, todayLib] = await Promise.all([
    readFile(new URL("../lib/daily-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/career-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/daily/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/career/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/today.ts", import.meta.url), "utf8"),
  ]);

  for (const source of [dailyDataFile, careerDataFile]) {
    assert.doesNotMatch(source, /import\.meta\.glob/);
    assert.match(source, /loadDataset/);
  }
  assert.match(dailyDataFile, /loadDataset<DailyData>\(db, "daily"\)/);
  assert.match(careerDataFile, /loadDataset<CareerData>\(db, "career"\)/);

  assert.match(dailyPage, /await loadDailyData\(env\.DB\)/);
  assert.match(careerPage, /await loadCareerData\(env\.DB\)/);
  assert.match(todayLib, /await loadCareerData\(env\.DB\)/);

  const apiFile = await readFile(new URL("../lib/private-data-api.ts", import.meta.url), "utf8");
  assert.doesNotMatch(apiFile, /requireImportAccess\(/);
  assert.match(apiFile, /decideDatasetAuth/);
  assert.match(apiFile, /content-length/);
});

test("sha256 ignores the build timestamp so an unchanged nightly rebuild is 'unchanged'", async () => {
  const put = handleDatasetPut;
  const { db } = setup();
  const day = { date: "2026-03-01", weekday: "周日", summary: "样例", commits: 1, repos: ["demo"], tokensM: null, sections: {}, repoStats: [] };
  const first = await put({ db, name: "daily", rawBody: JSON.stringify({ generatedAt: "2026-03-01T00:00:00Z", days: [day] }), actor: "t", now: "n1" });
  assert.equal(first.body.status, "updated");
  const again = await put({ db, name: "daily", rawBody: JSON.stringify({ generatedAt: "2026-03-02T00:00:00Z", days: [day] }), actor: "t", now: "n2" });
  assert.equal(again.body.status, "unchanged");
  const changed = await put({ db, name: "daily", rawBody: JSON.stringify({ generatedAt: "2026-03-02T00:00:00Z", days: [{ ...day, commits: 2 }] }), actor: "t", now: "n3" });
  assert.equal(changed.body.status, "updated");
});
