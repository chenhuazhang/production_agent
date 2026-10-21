/**
 * 模型降级执行器（同一端点 / 同一 Key，各模型独立免费额度）
 *
 * 阿里云百炼专属端点下每个模型有独立的免费额度。额度用尽时 API 返回
 * 额度类错误（非限流/5xx，框架自动重试不覆盖），本模块负责：
 *   1. 识别"额度用尽"错误
 *   2. 当前模型额度用尽 → session.setModel(下一个模型) → 重跑本轮
 *   3. 全部模型额度用尽 → 抛错（由调用方转成对外的错误响应）
 *
 * 事件时序：message_end(error) 先于 agent_end。降级时吞掉失败回合的
 * error + agent_end（不转发给 onEvent），避免客户端看到失败轮次的事件。
 */

import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { UserContext } from "./services/userContext";

type AnyModel = Model<any>;
import { runWithUser } from "./services/userContext";

/**
 * 额度用尽错误识别正则。
 * 覆盖中英文常见文案：quota / exhausted / insufficient balance / 欠费 / 额度不足 / 未开通 …
 * 注意不匹配上下文过长、工具报错等非额度错误，避免误降级。
 */
const QUOTA_ERROR_RE =
  /(quota|quotas|exhausted|exceeded.{0,20}(limit|quota)|insufficient.{0,20}(quota|balance|credit|funds?)|arrearage|arrears|欠费|(额度|配额)(不足|用完|用尽|已用完|已用尽)|余额不足|account.{0,10}balance|no.{0,3}permission|未开通|未授权|免费.{0,8}(额度|配额|次数|token)|trial.{0,10}(ended|expired))/i;

export function isQuotaExhaustedError(message: string): boolean {
  return QUOTA_ERROR_RE.test(message);
}

export interface ModelFallbackOptions {
  session: AgentSession;
  /** 每个会话的当前用户消息 */
  text: string;
  /** 工具执行时的 ALS 用户上下文 */
  user: UserContext;
  /** 模型降级链（已按顺序解析为 Model 实例） */
  modelChain: AnyModel[];
  /**
   * 事件转发回调（SSE 输出 / tracer 记录）。
   * 降级时失败回合的 message_end(error) 与 agent_end 会被过滤，不进入此回调。
   */
  onEvent: (raw: AgentSessionEvent) => void;
  /** 自定义额度错误判断（默认 isQuotaExhaustedError） */
  isQuotaError?: (message: string) => boolean;
}

export type FallbackRunResult =
  | { status: "ok" }
  /** 非额度错误（立即返回，不降级）或降级链全部额度用尽 */
  | { status: "error"; message: string };

/**
 * 带模型降级的 prompt 执行。返回后调用方负责把 error 转成对外响应。
 */
export async function runPromptWithModelFallback(
  opts: ModelFallbackOptions,
): Promise<FallbackRunResult> {
  const { session, text, user, modelChain, onEvent } = opts;
  const isQuota = opts.isQuotaError ?? isQuotaExhaustedError;

  if (modelChain.length === 0) {
    return {
      status: "error",
      message: "模型降级链为空，请配置 AI_MODEL / AI_MODEL_FALLBACKS",
    };
  }

  for (let idx = 0; idx < modelChain.length; idx++) {
    const target = modelChain[idx];

    // 确保当前模型为链上第 idx 个（首次通常已是主模型，跳过 setModel）
    if (!session.model || session.model.id !== target.id) {
      await session.setModel(target);
    }

    const outcome = await executeTurn(session, text, user, onEvent, isQuota);

    if (outcome.status === "ok") return { status: "ok" };

    // 非额度错误：不是降级能解决的，立即返回
    if (outcome.status === "error") return outcome;

    // outcome.status === "quota" → 尝试下一个模型
    if (idx < modelChain.length - 1) {
      console.warn(
        `[model-fallback] ${target.id} 额度用尽，切换到 ${modelChain[idx + 1].id}`,
      );
    } else {
      return {
        status: "error",
        message: `当前模型额度全部用尽：${modelChain
          .map((m) => m.id)
          .join(" → ")} 均不可用，请续费或更换已开通的模型。`,
      };
    }
  }

  return { status: "error", message: "模型降级执行异常" };
}

/** 执行单次完整回合。返回 "ok" / "quota"（额度用尽，可降级）/ "error"（其他错误） */
function executeTurn(
  session: AgentSession,
  text: string,
  user: UserContext,
  onEvent: (raw: AgentSessionEvent) => void,
  isQuota: (message: string) => boolean,
): Promise<{ status: "ok" } | { status: "quota" } | { status: "error"; message: string }> {
  return new Promise((resolve, reject) => {
    let suppressed = false;
    let errorMessage: string | null = null;

    const unsub = session.subscribe((raw) => {
      // 已决定降级/出错：吞掉本回合剩余事件（含失败回合的 agent_end），
      // 避免客户端拿到 "done" 后又等到重试的流。
      if (suppressed) return;

      if (raw.type === "message_end") {
        const msg = raw.message as { stopReason?: string; errorMessage?: string };
        if (msg.stopReason === "error" && msg.errorMessage) {
          suppressed = true;
          errorMessage = msg.errorMessage;
          return; // 不转发错误事件，由调用方统一处理
        }
      }

      onEvent(raw);
    });

    runWithUser(user, () => session.prompt(text))
      .then(() => {
        unsub();
        if (!suppressed) resolve({ status: "ok" });
        else if (errorMessage && isQuota(errorMessage)) resolve({ status: "quota" });
        else resolve({ status: "error", message: errorMessage ?? "Agent error" });
      })
      .catch((err) => {
        unsub();
        resolve({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
  });
}