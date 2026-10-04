# 印章动效本地预览指南

"今天"页（`/`）的印章栏目只有管理员登录后才会渲染，本地预览需要：起一个本地生产模式服务、往本地 D1 里放一份假日报数据、再用浏览器控制台调整 `localStorage` 里的印章状态。全程只在本地做，**不要对线上环境执行本文档里的任何命令**。

仓库是公开的：假数据脚本（`scripts/seal-mock-daily.mjs`）输出的全部是虚构内容，本文档示例里也不写真 token。

## 1. 起本地服务

```bash
npm run build && PORT=3100 bash scripts/serve-prod.sh start
```

- 默认端口就是 3100，`PORT` 可换。`stop` / `status` / `logs` 子命令同脚本。
- 它复用 `npm run dev` 的本地 D1 状态（`.wrangler/state`），dev 和 prod 看到同一份数据。
- 打开 `http://localhost:3100/`，用本地管理员账号登录；非管理员看不到"新盖的章"栏目和刊头角色。

## 2. 生成并上传假日报数据

```bash
node scripts/seal-mock-daily.mjs > /tmp/seal-mock.json
curl -X PUT http://localhost:3100/api/daily/data \
  -H "x-import-token: $IMPORT_TOKEN" \
  --data-binary @/tmp/seal-mock-daily.json
```

`IMPORT_TOKEN` 配在 `.wrangler/prod/prod.env`（gitignore 的 KEY=VALUE 文件）里，先 `source` 或手动 export 到当前 shell；没有就自己生成一个随机值填进去再重启服务。**不要把真实 token 写进任何文件。**

脚本参数：

```bash
node scripts/seal-mock-daily.mjs --today 2026-03-10 --scenario streak
```

| scenario | 数据形状 | 预览什么 |
| --- | --- | --- |
| `streak`（默认） | 今天之前连续 9 天有提交，今天没记录 | 早上打开页面：昨日回放 + 补盖队列 + "连续提交 9 天" |
| `catchup` | 昨天和今天都有记录 | 当晚已上传：今天也会有一枚新方章 |
| `blank` | 最新一天（昨天）commits 为 0 | 空白日：角色趴下休息，页面不催 |
| `noyesterday` | 数据只到前天 | 昨天上传失败：不演昨日回放（数据里没有昨天） |
| `gap` | 中间断一天 | 连续天数从断点后重算（显示 4 天，不是 9 天） |

换 scenario 重传一次即可；上传的是同一份数据时接口会返回 `unchanged`，改动 commits 数值后才会真正覆盖。想清空回到"还没有日报数据"的 offline 状态，删掉本地 D1 里的记录（或换一个空 `days: []` 的 JSON 上传，注意 `generatedAt` 要变）。

## 3. 控制台模拟印章状态（`localStorage["superme.seal.v1"]`）

印章状态存在这个键里（见 `app/_components/seal/seal-store.ts`）：`firstSeenDate`、`lastVisitAt`、`seen`（已看过的事件键，如 `git:2026-03-09`、`replay:2026-03-10`、`wrap:2026-03-09`、`back:2026-03-10`）、`stampLog`（本设备页内章）。改完**刷新页面**生效。下面片段直接粘进控制台：

```js
const K = "superme.seal.v1";
const shToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
const read = () => JSON.parse(localStorage.getItem(K));
const write = (s) => localStorage.setItem(K, JSON.stringify(s));
```

### 新设备（第一次打开）

全部印痕直接显示为已盖、不播任何动画：

```js
localStorage.removeItem(K);
```

### 上次来是昨天、今天第一次打开（触发昨日回放）

把 `lastVisitAt` 挪到昨天，并删掉今天的 `replay:` 键（这个键写上就代表回放今天已经演过）：

```js
const s = read();
s.lastVisitAt = new Date(Date.now() - 86400e3).toISOString();
s.seen = s.seen.filter((x) => x !== "replay:" + shToday());
write(s);
```

配合 `streak` scenario：昨天数据在、`replay:` 键没写，刷新后先演全屏昨日回放，收起时飞进左侧小卡。

### 离开 4 天回来了（welcomeBack 快速补盖）

`lastVisitAt` 挪到 4 天前，`seen` 只留 4 天前的键（这几天的提交变成"新事件"），同时把 `firstSeenDate` 也放早一点，保证这几天的事件算"新"：

```js
const s = read();
const cutoff = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(Date.now() - 4 * 86400e3));
s.lastVisitAt = new Date(Date.now() - 4 * 86400e3).toISOString();
s.firstSeenDate = cutoff;
s.seen = s.seen.filter((x) => !/:(\d{4}-\d{2}-\d{2})$/.test(x) || x.slice(-10) < cutoff);
write(s);
```

刷新后角色跳一下打招呼，然后以 0.6 倍时长、120ms 间隔快速补盖这几天的章。

### 补盖 6 个（队列上限 5 + "还有 1 个"）

从 `seen` 里去掉最近 6 个 `git:` 键（它们重新变成待补盖事件），但保留今天的 `replay:` 键，这样不会再演昨日回放、直接进补盖队列：

```js
const s = read();
const recent = s.seen.filter((x) => x.startsWith("git:")).sort().slice(-6);
s.seen = s.seen.filter((x) => !recent.includes(x));
write(s);
```

前 5 枚逐个盖章，第 6 枚淡入，角色左下角出现"还有 1 个"。注意事件日期不能早于 `firstSeenDate` 才算新事件；如果这台"设备"是刚建的（`firstSeenDate` 是今天），把 `s.firstSeenDate` 也改早一点再试。

## 4. 常用排查

- 印章栏目整体不出现：确认是管理员登录、D1 里有 daily 数据（`curl` PUT 返回 200）。
- 想重置成全新状态：`localStorage.removeItem(K)` + 刷新。
- 动画参数、事件键规则见 `app/_components/seal/seal-moments.ts` 顶部注释与 `/workspace/design/ip/spec/seal-spec.md` 第 6、7、11 节。
