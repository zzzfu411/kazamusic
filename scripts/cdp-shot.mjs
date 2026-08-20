import { writeFileSync } from "node:fs";

const pages = await fetch("http://127.0.0.1:9229/json").then((r) => r.json());
if (!pages[0]) throw new Error("no page");
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

const shot = await send(1, "Page.captureScreenshot", { format: "png", fromSurface: true });
writeFileSync(process.argv[2] || "shot.png", Buffer.from(shot.data, "base64"));
console.log("wrote", process.argv[2] || "shot.png");
ws.close();
