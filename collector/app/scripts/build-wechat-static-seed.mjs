import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { localImageReferences, parseCsv, readMarkdownDocument } from "./backfill-wechat-markdown.mjs";

const sql = (value) => value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;

async function run() {
  const inputFlag = process.argv.indexOf("--input");
  const input = inputFlag >= 0 ? process.argv[inputFlag + 1] : "";
  if (!input) throw new Error("用法：node scripts/build-wechat-static-seed.mjs --input <公众号下载目录>");

  const accountName = path.basename(path.resolve(input));
  const accountHash = createHash("sha256").update(accountName).digest("hex").slice(0, 16);
  const sourceUrl = `wechat://seed-${accountHash}`;
  const assetRoot = path.resolve("public", "wechat-media", accountHash);
  const records = parseCsv(await readFile(path.join(input, "index.csv"), "utf8"))
    .filter((record) => record.status === "success" && record.markdown_path);

  const statements = [
    `INSERT INTO sources (kind, name, url, enabled, last_synced_at, created_at) VALUES ('wechat', ${sql(accountName)}, ${sql(sourceUrl)}, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(url) DO UPDATE SET kind = 'wechat', name = excluded.name, enabled = 1, last_synced_at = excluded.last_synced_at, last_error = NULL`,
  ];
  let imageCount = 0;

  for (const record of records) {
    const parsed = readMarkdownDocument(await readFile(path.join(input, record.markdown_path), "utf8"));
    let contentMarkdown = parsed.contentMarkdown;
    for (const reference of localImageReferences(contentMarkdown)) {
      const output = path.join(assetRoot, reference.relativePath);
      await mkdir(path.dirname(output), { recursive: true });
      await copyFile(path.join(input, "images", reference.relativePath), output);
      const web = `![${reference.alt}](/wechat-media/${accountHash}/${reference.relativePath.split(path.sep).join("/")})`;
      contentMarkdown = contentMarkdown.replaceAll(reference.full, web);
      imageCount += 1;
    }
    if (contentMarkdown.length < 160) continue;

    const title = record.title?.trim();
    const author = parsed.metadata.author || parsed.metadata.account || accountName;
    const publishedAt = parsed.metadata.publish_time || null;
    statements.push(`INSERT INTO items (source_id, kind, title, original_excerpt, content_markdown, author, translated_title, translated_excerpt, url, published_at, language, status, created_at) VALUES ((SELECT id FROM sources WHERE url = ${sql(sourceUrl)}), 'link', ${sql(title)}, '', ${sql(contentMarkdown.slice(0, 120_000))}, ${sql(author)}, ${sql(title)}, '', ${sql(record.source_url)}, ${sql(publishedAt)}, 'zh', 'ready', CURRENT_TIMESTAMP) ON CONFLICT(url) DO UPDATE SET source_id = excluded.source_id, title = excluded.title, content_markdown = excluded.content_markdown, author = excluded.author, translated_title = excluded.translated_title, published_at = COALESCE(excluded.published_at, items.published_at), language = 'zh', status = 'ready'`);
  }

  const migration = path.resolve("drizzle", "0003_seed_wechat_articles.sql");
  await writeFile(migration, `${statements.join(";\n--> statement-breakpoint\n")};\n`);
  console.log(JSON.stringify({ account: accountName, articles: statements.length - 1, images: imageCount, assetRoot, migration }));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
