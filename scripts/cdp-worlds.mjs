const pages = await fetch("http://127.0.0.1:9229/json").then((r) => r.json());
const page = pages.find((item) => item.type === "page" && item.title === "KAZAM") || pages[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
const send = (id, method, params) =>
  new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === id) {
        ws.removeEventListener("message", onMsg);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
const contexts = [];
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", reject);
});
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === "Runtime.executionContextCreated") contexts.push(msg.params.context);
});
await send(1, "Runtime.enable", {});
await new Promise((r) => setTimeout(r, 300));
console.log("contexts", JSON.stringify(contexts, null, 2));
for (const ctx of contexts) {
  const result = await send(10 + ctx.id, "Runtime.evaluate", {
    expression: `JSON.stringify({electronAPI: typeof window.electronAPI, require: typeof require, process: typeof process, keys: Object.getOwnPropertyNames(window).filter(k=>/electron|API|ipc/i.test(k))})`,
    contextId: ctx.id,
    returnByValue: true,
  });
  console.log("ctx", ctx.id, ctx.name, ctx.origin, result?.result?.value);
}
ws.close();
