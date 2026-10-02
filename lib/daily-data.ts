import type { DailyData } from "./daily.ts";
import { loadDataset } from "./private-data.ts";

/**
 * /daily 的私密数据在运行时从 D1 的 private_datasets 表读取。
 * 由 `scripts/upload-daily.sh` 上传，站点构建不再读取 content/daily/。
 * 不存在或损坏时返回 null，页面显示空状态。
 */
export async function loadDailyData(db: D1Database): Promise<DailyData | null> {
  return loadDataset<DailyData>(db, "daily");
}
