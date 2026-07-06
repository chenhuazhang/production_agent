/**
 * Agent Session
 *
 * 创建 Agent Session：
 * - 多供应商模型装配（deepseek / openai / qwen …）
 * - ResourceLoader + Skills 合并
 * - JSONL 会话持久化（SessionManager.create）
 * - 自动上下文压缩（默认 SettingsManager 已启用 Compaction）
 */

import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  AuthStorage,
  ModelRegistry,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai";

import type { AgentConfig } from "./types";
import { getEnvConfig, getDefaultSkills, defaultAgentConfig } from "./config";
import { agentTools, TOOL_NAMES } from "./tools";

/**
 * 创建 Agent Session
 *
 * @example
 * ```ts
 * const { session } = await createSession();
 * const unsubscribe = subscribeToEvents(session, printEvent);
 * await session.prompt("查询 ZS-2026-001 进度");
 * unsubscribe();
 * ```
 */
export async function createSession(config: AgentConfig = {}) {
  const finalConfig = { ...defaultAgentConfig, ...config };
  const cwd = finalConfig.cwd ?? process.cwd();

  // ── 1. 读取环境配置（多供应商） ───────────────
  const envConfig = getEnvConfig();

  // ── 2. 配置 Auth 和 Model ──────────────────────
  const authStorage = AuthStorage.create();
  authStorage.setRuntimeApiKey(envConfig.provider, envConfig.apiKey);

  const modelRegistry = ModelRegistry.create(authStorage);

  // 优先从 registry 查找；找不到则用 pi-ai 内置 getModel 兜底
  let model = modelRegistry.find(envConfig.provider as never, envConfig.model);
  if (!model) {
    model = getModel(envConfig.provider as never, envConfig.model as never);
  }
  if (!model) {
    throw new Error(
      `无法找到模型 ${envConfig.provider}/${envConfig.model}。请检查 AI_PROVIDER / AI_MODEL / AI_API_KEY 配置。`,
    );
  }

  // ── 3. 配置 ResourceLoader ─────────────────────
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    skillsOverride: (current) => ({
      skills: [
        ...current.skills,
        ...getDefaultSkills(),
        ...(finalConfig.skills ?? []),
      ],
      diagnostics: current.diagnostics,
    }),
  });
  await loader.reload();

  // ── 4. 创建 Session ───────────────────────────
  // SessionManager.create(cwd) = JSONL 文件持久化（支持历史回溯 / 分支 / fork）
  // 默认 SettingsManager 已启用 Compaction（上下文自动压缩）
  const { session } = await createAgentSession({
    cwd,
    model,
    thinkingLevel: "low", // 启用思考链（reasoning 模型会输出 thinking_delta，已转发到前端）
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.create(cwd),
    resourceLoader: loader,

    // 自定义工具
    customTools: agentTools,

    // 工具白名单：仅启用我们的 6 个领域工具（不启用 read/bash/edit/write 等编码工具）
    tools: TOOL_NAMES,
  });

  return {
    session,
    loader,
    dispose: () => {
      session.dispose();
    },
  };
}
