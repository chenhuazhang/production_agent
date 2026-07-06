// 测试 thinking_delta 事件是否被转发
const URL = "http://localhost:8000/api/chat/think-test-02";
const PROMPT = "帮我算一下 15 x 37 + 8 等于多少";

async function run() {
  console.log(`>>> 发送: ${PROMPT}\n`);
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: PROMPT }),
  });
  if (!res.ok) { console.error("失败:", res.status, await res.text()); process.exit(1); }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = ""; let curEvent = "message"; let thinkingShown = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let sep;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, sep); buf = buf.slice(sep + 2);
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) curEvent = line.slice(6).trim();
        else if (line.startsWith("data:")) {
          try {
            const d = JSON.parse(line.slice(5).trim());
            switch (curEvent) {
              case "thinking_delta":
                if (!thinkingShown) { console.log("\n🧠 Thinking:"); thinkingShown = true; }
                process.stdout.write(d.delta);
                break;
              case "text_delta":
                if (thinkingShown) { console.log("\n💬 Response:"); thinkingShown = false; }
                process.stdout.write(d.delta);
                break;
              case "tool_start": console.log(`\n[tool_start] ${d.toolName}`); break;
              case "tool_end": console.log(`[tool_end] ${d.toolName} ${d.isError ? "❌" : "✅"}`); break;
              case "done": console.log("\n[done]"); break;
              case "error": console.error(`[error] ${d.message}`); break;
            }
          } catch {}
        }
      }
      curEvent = "message";
    }
  }
  console.log("\n\n>>> 流式结束");
}
run().catch((e) => { console.error(e); process.exit(1); });
