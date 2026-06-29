/**
 * Agent Configuration
 *
 * 集中管理配置：
 * - 环境变量读取（多供应商）
 * - Skills 定义
 */

import type { EnvConfig, AgentConfig } from "./types";
import type { Skill, SourceInfo } from "@earendil-works/pi-coding-agent";

// ============================================
// 环境配置
// ============================================

/**
 * 从环境变量读取 AI 模型配置。
 * 支持多供应商：deepseek / openai / qwen / anthropic / google …
 */
export function getEnvConfig(): EnvConfig {
  const provider = (process.env.AI_PROVIDER || "deepseek").toLowerCase();
  const apiKey = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL || "deepseek-v4-flash";

  if (!apiKey) {
    throw new Error(
      "缺少 AI_API_KEY 环境变量。\n" +
      "请在 pi_agent/.env 中设置:\n" +
      "  AI_PROVIDER=deepseek\n" +
      "  AI_API_KEY=your-api-key\n" +
      "  AI_MODEL=deepseek-v4-flash  # 可选\n",
    );
  }

  return { provider, apiKey, model };
}

// ============================================
// Skills 定义
// ============================================

/** 订单进度查询行为规范 */
export const orderProgressSkill: Skill = {
  name: "order-progress",
  description: `查询中试订单生产进度。用途：用户询问订单状态、当前工序、负责人、计划完成日期时使用。`,
  filePath: "./skills/order-progress/SKILL.md",
  baseDir: "./skills/order-progress",
  sourceInfo: createSourceInfo("project", "project"),
  disableModelInvocation: false,
};

/** 产能分析行为规范 */
export const capacityAnalysisSkill: Skill = {
  name: "capacity-analysis",
  description: `分析五大中试基地产能负荷、推荐下单基地、估算交期。用途：用户询问"哪个基地负荷低""推荐下单""交期多久"时使用。`,
  filePath: "./skills/capacity-analysis/SKILL.md",
  baseDir: "./skills/capacity-analysis",
  sourceInfo: createSourceInfo("project", "project"),
  disableModelInvocation: false,
};

/** 输出格式规范 */
export const outputFormatSkill: Skill = {
  name: "output-format",
  description: `规范化输出格式，提升阅读体验。卡片式布局、emoji 图标、表格、行内代码高亮。`,
  filePath: "./skills/output-format/SKILL.md",
  baseDir: "./skills/output-format",
  sourceInfo: createSourceInfo("project", "project"),
  disableModelInvocation: false,
};

/** 获取默认 Skills */
export function getDefaultSkills(): Skill[] {
  return [orderProgressSkill, capacityAnalysisSkill, outputFormatSkill];
}

function createSourceInfo(source: string, scope: string): SourceInfo {
  return {
    path: "",
    source,
    scope: scope as never,
    origin: "project" as never,
    baseDir: undefined,
  };
}

// ============================================
// 默认配置
// ============================================

export const defaultAgentConfig: AgentConfig = {
  cwd: process.cwd(),
  model: "deepseek-v4-flash",
  skills: [],
};
