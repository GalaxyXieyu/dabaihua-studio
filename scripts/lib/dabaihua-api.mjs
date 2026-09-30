/**
 * dabaihua-api.mjs — 晴儿脚本共用的认证与 base 解析。
 *
 * 认证：DABAIHUA_API_KEY 优先；否则读 ~/.config/topics-cli/config.json 的 token。
 * base：--base > DABAIHUA_BASE_URL > config.endpoint > https://topic.aigalaxy.top。
 * 本模块绝不打印 key。
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const DEFAULT_BASE = "https://topic.aigalaxy.top";
export const CONFIG_DIR = process.env.TOPICS_CONFIG_DIR || path.join(homedir(), ".config", "topics-cli");
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export function loadConfig() {
  try {
    if (existsSync(CONFIG_FILE)) return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    /* 配置损坏时按未登录处理 */
  }
  return {};
}

export function resolveBase(flagBase) {
  const configured = flagBase || process.env.DABAIHUA_BASE_URL || loadConfig().endpoint || DEFAULT_BASE;
  return String(configured).trim().replace(/\/+$/, "");
}

export function resolveKey() {
  const envKey = String(process.env.DABAIHUA_API_KEY || "").trim();
  if (envKey) return envKey;
  return String(loadConfig().token || "").trim();
}

/** JSON request helper. Never logs the token or request body. */
export async function apiRequest(base, token, pathname, options = {}) {
  const response = await fetch(base + pathname, {
    method: options.method || "GET",
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    const detail = Array.isArray(data.errors) ? data.errors.join("；") : data.error || `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return data;
}
