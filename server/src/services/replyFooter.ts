/**
 * Agent 回复末尾附加的反馈提示
 *
 * 所有消费方通用：web SSE 聊天（/api/chat/:sessionId）+ MaxKB OpenAI 兼容接口（/v1/chat/completions）。
 * 只做传输层附加——不写入会话历史 JSONL、不进入模型上下文，
 * 避免页脚被当作 assistant 内容污染后续 prompt（占用 tokens / 历史压缩）。
 */

export const REPLY_FOOTER =
  "📋 如本次回答未解决问题或有建议，欢迎填写反馈表：https://doc.weixin.qq.com/forms/APoA1gfZAAoAb4AIgYJAFsCNLIozj6kwf";

/** 在回复文本末尾追加反馈提示；空文本原样返回（由调用方做空回复兜底）。 */
export function withReplyFooter(text: string): string {
  return text ? `${text}\n\n${REPLY_FOOTER}` : text;
}

/**
 * 从回复文本末尾剥离反馈页脚（含其前导换行），连续出现时全部剥掉。
 * 用于清理 MaxKB 多轮对话历史：上游把「正文 + 页脚」一起存下来再原样发回，
 * 若不剥离，模型会把页脚当成自己上一轮的固定语气复述出来，导致页面出现重复页脚。
 */
export function stripReplyFooter(text: string): string {
  if (!text) return text;
  let out = text;
  while (out.endsWith(REPLY_FOOTER)) {
    out = out.slice(0, out.length - REPLY_FOOTER.length).trimEnd();
  }
  return out;
}