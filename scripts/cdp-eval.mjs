const expr = process.argv[2];
if (!expr) throw new Error("expression required");
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
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", reject);
});
const result = await send(1, "Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
console.log(result?.result?.value ?? JSON.stringify(result));
ws.close();
