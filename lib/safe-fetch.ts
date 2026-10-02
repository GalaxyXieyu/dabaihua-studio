const MAX_URL_LENGTH = 2048;
const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal"];

export function publicHttpUrl(value: string) {
  if (!value || value.length > MAX_URL_LENGTH) throw new Error("链接长度不合法");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("请输入有效链接");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("只支持 http:// 或 https:// 链接");
  if (url.username || url.password) throw new Error("链接中不能包含用户名或密码");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix)) || isPrivateIp(host)) {
    throw new Error("不能抓取本机或内网地址");
  }
  return url;
}

function isPrivateIp(host: string) {
  if (host.includes(":")) {
    const normalized = host.toLowerCase();
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb");
  }
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
  const parts = host.split(".").map(Number);
  if (parts.some((part) => part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

async function limitedText(response: Response, maxBytes: number) {
  if (!response.body) return "";
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("来源内容过大，已停止抓取");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let value = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("来源内容过大，已停止抓取");
    }
    value += decoder.decode(chunk.value, { stream: true });
  }
  return value + decoder.decode();
}

export async function fetchPublicText(value: string, options: { accept?: string; maxBytes: number; timeoutMs?: number; userAgent?: string }) {
  let url = publicHttpUrl(value);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
        headers: {
          accept: options.accept || "text/html,application/xhtml+xml",
          "user-agent": options.userAgent || "Mozilla/5.0 (compatible; PersonalIntelDesk/1.0)",
        },
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new Error("来源响应超时");
      throw error;
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === 3) throw new Error("来源重定向次数过多");
      url = publicHttpUrl(new URL(location, url).toString());
      continue;
    }
    return { response, text: response.ok ? await limitedText(response, options.maxBytes) : "", url: url.toString() };
  }
  throw new Error("抓取失败");
}
