/**
 * Agent Session
 *
 * 创建 Agent Session：
 * - 多供应商模型装配（deepseek / openai / qwen …）
 * - ResourceLoader + Skills 合并
 * - JSONL 会话持久化（SessionManager.create）
 * - 自动上下文压缩（默认 SettingsManager 已启用 Compaction）
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  AuthStorage,
  ModelRegistry,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai";
import type { Model } from "@earendil-works/pi-ai";

type AnyModel = Model<any>;

import type { AgentConfig } from "./types";
import {
  getEnvConfig,
  getModelFallbackChain,
  getDefaultSkills,
  defaultAgentConfig,
} from "./config";
import { agentTools, TOOL_NAMES } from "./tools";

const AGENT_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * 把 3 个 SKILL.md 正文读成系统提示片段。
 *
 * 背景：框架的 <available_skills> 机制要求模型用 read 工具加载技能文件，
 * 但本 Agent 的工具白名单禁止 filesystem 访问（CLAUDE.md 边界 2），
 * 因此 SKILL.md 必须由服务端直接注入系统提示（与 flows.md 设计一致：
 * 系统提示 = AGENTS.md + 3 SKILL.md）。
 */
function buildSkillPromptBlocks(): string[] {
  const blocks: string[] = [];
  for (const skill of getDefaultSkills()) {
    try {
      const raw = readFileSync(join(AGENT_DIR, skill.filePath), "utf-8");
      const body = raw.replace(/^---[\s\S]*?---\s*/, "").trim(); // 去掉 frontmatter
      blocks.push(`<skill name="${skill.name}">\n${body}\n</skill>`);
    } catch (err) {
      console.warn(
        `[session] skill ${skill.name} 加载失败:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return blocks;
}

/**
 * 解析单个模型 id → Model 实例。
 * 优先从 registry（models.json）查找；找不到则用 pi-ai 内置 getModel 兜底。
 */
function resolveModel(
  modelRegistry: ModelRegistry,
  provider: string,
  modelId: string,
): AnyModel | undefined {
  const fromRegistry = modelRegistry.find(provider as never, modelId);
  if (fromRegistry) return fromRegistry;
  return getModel(provider as never, modelId as never) as AnyModel | undefined;
}

/**
 * 解析模型降级链（AI_MODEL + AI_MODEL_FALLBACKS）为 Model 实例数组。
 * 任一模型无法解析时抛错，避免运行时才发现配置缺失。
 */
export function resolveModelChain(
  modelRegistry: ModelRegistry,
  provider: string,
): AnyModel[] {
  const chain = getModelFallbackChain();
  const models: AnyModel[] = [];
  for (const id of chain) {
    const model = resolveModel(modelRegistry, provider, id);
    if (!model) {
      throw new Error(
        `无法找到模型 ${provider}/${id}。请检查 AI_PROVIDER / AI_MODEL / AI_MODEL_FALLBACKS 配置与 models.json。`,
      );
    }
    models.push(model);
  }
  return models;
}

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

  // 解析模型降级链（主模型 + 降级模型），首个即当前模型
  const modelChain = resolveModelChain(modelRegistry, envConfig.provider);
  const model = modelChain[0];

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
    // SKILL.md 正文直接注入系统提示（白名单无 read 工具，模型无法自行加载技能文件）
    // + 业务范围说明（MaxKB 多智能体按模型名分流时由服务端传入）
    appendSystemPrompt: [
      ...buildSkillPromptBlocks(),
      ...(finalConfig.scopeNote ? [finalConfig.scopeNote] : []),
    ],
  });
  await loader.reload();

  // ── 4. 创建 Session ───────────────────────────
  // SessionManager.create(cwd) = JSONL 文件持久化（支持历史回溯 / 分支 / fork）
  // 续聊：传入已有会话文件时用 SessionManager.open 恢复上下文（含全部历史消息）
  // 默认 SettingsManager 已启用 Compaction（上下文自动压缩）
  const { session } = await createAgentSession({
    cwd,
    model,
    thinkingLevel: "low", // 启用思考链（reasoning 模型会输出 thinking_delta，已转发到前端）
    authStorage,
    modelRegistry,
    sessionManager: finalConfig.sessionFile
      ? SessionManager.open(finalConfig.sessionFile, undefined, cwd)
      : SessionManager.create(cwd),
    resourceLoader: loader,

    // 自定义工具
    customTools: agentTools,

    // 工具白名单：仅启用我们的 7 个领域工具（不启用 read/bash/edit/write 等编码工具）
    tools: TOOL_NAMES,
  });

  return {
    session,
    loader,
    /** 模型降级链（同端点同 Key，额度用尽时按序切换） */
    modelChain,
    dispose: () => {
      session.dispose();
    },
  };
}
