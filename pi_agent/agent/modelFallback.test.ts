/**
 * 模型降级执行器单元测试
 *
 * 覆盖：
 * - isQuotaExhaustedError：额度用尽文案识别（中/英），非额度错误不误判
 * - runPromptWithModelFallback：额度用尽切模型 / 非额度错误不降级 / 全部用尽报错 / 空链
 */

import { describe, expect, it } from "vitest";
import {
  isQuotaExhaustedError,
  runPromptWithModelFallback,
} from "./modelFallback.js";
import type { UserContext } from "./services/userContext.js";

const USER: UserContext = { userId: "test", role: "supervisor", baseId: null };

/** 每次 prompt 返回的事件序列 */
type Outcome = "ok" | "quota" | "error";

class MockSession {
  currentId: string | null;
  outcomes: Outcome[] = [];
  promptCalls: string[] = [];
  setModelCalls: string[] = [];
  private listeners = new Set<(raw: unknown) => void>();

  constructor(initialId: string) {
    this.currentId = initialId;
  }

  get model() {
    return this.currentId ? { id: this.currentId } : undefined;
  }

  subscribe(fn: (raw: unknown) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async setModel(model: { id: string }): Promise<void> {
    this.currentId = model.id;
    this.setModelCalls.push(model.id);
  }

  async prompt(_text: string): Promise<void> {
    this.promptCalls.push(this.currentId!);
    const outcome = this.outcomes.shift() ?? "ok";
    const emit = (raw: unknown) => this.listeners.forEach((fn) => fn(raw));
    if (outcome === "quota") {
      emit({
        type: "message_end",
        message: { stopReason: "error", errorMessage: "Exceeded the actual available quota" },
      });
      emit({ type: "agent_end", messages: [] });
    } else if (outcome === "error") {
      emit({
        type: "message_end",
        message: { stopReason: "error", errorMessage: "Context length exceeded, please reduce" },
      });
      emit({ type: "agent_end", messages: [] });
    } else {
      emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello" } });
      emit({ type: "agent_end", messages: [] });
    }
  }
}

function run(session: MockSession, modelChain: Array<{ id: string }>, onEvent?: (raw: unknown) => void) {
  const events: unknown[] = [];
  return runPromptWithModelFallback({
    session: session as never,
    text: "查询进度",
    user: USER,
    modelChain: modelChain as never,
    onEvent: onEvent ?? ((raw) => events.push(raw)),
  }).then((result) => ({ result, events }));
}

describe("isQuotaExhaustedError（额度用尽识别）", () => {
  it("匹配中英文额度/欠费/配额文案", () => {
    const cases = [
      "Exceeded the actual available quota",
      "The user quota is exhausted",
      "quota is not enough",
      "insufficient balance",
      "insufficient fund",
      "用户额度不足",
      "额度已用完",
      "免费额度已用尽",
      "欠费",
      "余额不足",
      "Arrearage",
      "NoPermission, the model is not in your plan",
      "免费token已用完",
    ];
    for (const c of cases) expect(isQuotaExhaustedError(c), c).toBe(true);
  });

  it("不误判非额度错误", () => {
    const cases = [
      "Context length exceeded, please reduce the prompt",
      "The model is temporarily overloaded",
      "Connection refused",
      "Invalid API key",
      "Request timed out",
      "Tool queryOrderProgress failed: SQL Server unreachable",
      "rate limit exceeded, retry later",
    ];
    for (const c of cases) expect(isQuotaExhaustedError(c), c).toBe(false);
  });
});

describe("runPromptWithModelFallback（降级执行）", () => {
  it("主模型额度用尽 → 切下一个模型重跑 → ok", async () => {
    const session = new MockSession("qwen3.8-max");
    session.outcomes = ["quota", "ok"];
    const { result, events } = await run(session, [
      { id: "qwen3.8-max" },
      { id: "glm-5.2" },
    ]);
    expect(result.status).toBe("ok");
    expect(session.setModelCalls).toEqual(["glm-5.2"]);
    expect(session.promptCalls).toEqual(["qwen3.8-max", "glm-5.2"]);
    // 失败回合的 error/agent_end 不转发，只有成功轮的 text_delta + agent_end
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "message_update" });
    expect(events[1]).toMatchObject({ type: "agent_end" });
  });

  it("非额度错误不降级，直接返回 error", async () => {
    const session = new MockSession("qwen3.8-max");
    session.outcomes = ["error"];
    const { result } = await run(session, [
      { id: "qwen3.8-max" },
      { id: "glm-5.2" },
    ]);
    expect(result.status).toBe("error");
    expect(result.message).toContain("Context length");
    expect(session.setModelCalls).toEqual([]);
    expect(session.promptCalls).toEqual(["qwen3.8-max"]);
  });

  it("降级链全部额度用尽 → 返回全部用尽错误", async () => {
    const session = new MockSession("qwen3.8-max");
    session.outcomes = ["quota", "quota"];
    const { result } = await run(session, [
      { id: "qwen3.8-max" },
      { id: "glm-5.2" },
    ]);
    expect(result.status).toBe("error");
    expect(result.message).toContain("全部用尽");
    expect(session.setModelCalls).toEqual(["glm-5.2"]);
    expect(session.promptCalls).toEqual(["qwen3.8-max", "glm-5.2"]);
  });

  it("空降级链 → 返回配置错误", async () => {
    const session = new MockSession("qwen3.8-max");
    const { result } = await run(session, []);
    expect(result.status).toBe("error");
    expect(result.message).toContain("降级链为空");
  });
});