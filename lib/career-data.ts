import type { CareerData } from "./career.ts";
import { loadDataset } from "./private-data.ts";

/**
 * /career 的私密数据在运行时从 D1 的 private_datasets 表读取。
 * 由 `scripts/upload-daily.sh --career` 上传，站点构建不再读取 content/career/。
 * 不存在或损坏时返回 null，页面显示空状态。
 */
export async function loadCareerData(db: D1Database): Promise<CareerData | null> {
  return loadDataset<CareerData>(db, "career");
}
