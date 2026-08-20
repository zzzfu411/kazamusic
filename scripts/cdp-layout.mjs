const pages = await fetch("http://127.0.0.1:9229/json").then((r) => r.json());
if (!pages[0]) throw new Error("no page");
const expr = `(() => {
  const app = document.querySelector(".app");
  const cs = app ? getComputedStyle(app) : null;
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { cls: String(el.className).slice(0, 80), x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  };
  return JSON.stringify({
    rows: cs && cs.gridTemplateRows,
    kids: app ? [...app.children].map(box) : [],
    controls: box(document.querySelector(".titlebar-controls")),
    player: box(document.querySelector(".player")),
    dock: box(document.querySelector(".player-dock")),
    win: { iw: innerWidth, ih: innerHeight },
  });
})()`;

const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("error", reject);
  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true } }));
  });
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    const value = msg.result?.result?.value ?? msg;
    console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
    ws.close();
    resolve(null);
  });
});
