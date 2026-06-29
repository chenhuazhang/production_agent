// 端到端测试：POST 聊天，消费 SSE 流
const URL = "http://localhost:8000/api/chat/e2e-test-01";
const PROMPT = "推荐一个最适合下单的基地";

async function run() {
  console.log(`>>> 发送: ${PROMPT}\n`);
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: PROMPT }),
  });
  if (!res.ok) {
    console.error("请求失败:", res.status, await res.text());
    process.exit(1);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let curEvent = "message";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let sep;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) curEvent = line.slice(6).trim();
        else if (line.startsWith("data:")) {
          const dataStr = line.slice(5).trim();
          try {
            const data = JSON.parse(dataStr);
            switch (curEvent) {
              case "text_delta":
                process.stdout.write(data.delta || "");
                break;
              case "tool_start":
                console.log(`\n[tool_start] ${data.toolName}`, data.args || "");
                break;
              case "tool_end":
                console.log(`\n[tool_end] ${data.toolName} ${data.isError ? "❌" : "✅"}`);
                break;
              case "done":
                console.log("\n[done]");
                break;
              case "error":
                console.error(`\n[error] ${data.message}`);
                break;
            }
          } catch {
            console.error("invalid JSON:", dataStr);
          }
        }
      }
      curEvent = "message";
    }
  }
  console.log("\n>>> 流式结束");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
