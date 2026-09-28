/**
 * digest-pi.mjs — 统一的 pi CLI 调用封装。
 *
 * 负责 PATH 准备、OPENCODE_API_KEY 查找（环境变量或本机密钥库）以及输出脱敏。
 * 绝不把密钥写进日志或错误信息。
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { decodeUtf8Chunks, truncate } from "./digest-text.mjs";

export const DEFAULT_MODEL = "opencode-go/deepseek-v4.1-flash";
const SECRETS_PATH = "/home/box/agent-data/box-secrets.json";
const LOCAL_BIN = "/home/box/.local/bin";

let cachedSecretsKey;

function secretsKey() {
  if (cachedSecretsKey !== undefined) return cachedSecretsKey;
  try {
    const raw = JSON.parse(readFileSync(SECRETS_PATH, "utf8"));
    cachedSecretsKey = String(raw?.card?.OPENCODE_API_KEY || "");
  } catch {
    cachedSecretsKey = "";
  }
  return cachedSecretsKey;
}

/** 优先环境变量，其次本机密钥库；都没有则返回空串。 */
export function loadPiKey() {
  return process.env.OPENCODE_API_KEY || secretsKey() || "";
}

export function resolveModel() {
  return process.env.DIGEST_MODEL || DEFAULT_MODEL;
}

export function redact(text, key) {
  const value = String(text ?? "");
  if (!key) return value;
  return value.split(key).join("***");
}

function buildPiEnv() {
  const env = { ...process.env };
  const key = loadPiKey();
  // 只在子进程环境里注入密钥，不修改 process.env，也不打印。
  if (!process.env.OPENCODE_API_KEY && key) env.OPENCODE_API_KEY = key;
  env.PATH = env.PATH ? `${LOCAL_BIN}:${env.PATH}` : LOCAL_BIN;
  return env;
}

/**
 * 调用 pi -p。stdin 固定为 /dev/null，参数与 requirements 一致。
 * - prompt: 提示词
 * - timeoutMs: 单次超时，默认 10 分钟（选题筛选）；摘要调用传 3 分钟。
 */
export function runPi(prompt, { timeoutMs = 10 * 60 * 1000 } = {}) {
  const piBin = process.env.PI_BIN || "pi";
  const model = resolveModel();
  const env = buildPiEnv();
  const key = env.OPENCODE_API_KEY || "";
  if (!key) {
    return Promise.reject(new Error("未找到 OPENCODE_API_KEY（环境变量或密钥库），无法调用 pi"));
  }
  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      "--no-session",
      "--no-tools",
      "--no-context-files",
      "--no-skills",
      "--no-extensions",
      "--model",
      model,
      prompt,
    ];
    const child = spawn(piBin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    // 收集原始 Buffer，最后一次性解码，避免多字节字符被 chunk 边界切断。
    const stdoutChunks = [];
    const stderrChunks = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`pi 调用超过 ${Math.round(timeoutMs / 60000)} 分钟，已终止`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdoutChunks.push(chunk); });
    child.stderr.on("data", (chunk) => { stderrChunks.push(chunk); });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(redact(error.message, key)));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(decodeUtf8Chunks(stdoutChunks));
      else {
        const stderr = decodeUtf8Chunks(stderrChunks);
        reject(new Error(redact(`pi 退出码 ${code}: ${truncate(stderr, 400)}`, key)));
      }
    });
  });
}
