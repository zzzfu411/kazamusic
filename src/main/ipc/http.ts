import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export function httpText(
  url: string,
  method: "GET" | "POST" = "GET",
  body: string | null = null,
  headers: Record<string, string> = {},
  timeoutMs = 15000,
): Promise<string> {
  return new Promise((resolve) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      resolve("");
      return;
    }
    const lib = parsed.protocol === "http:" ? httpRequest : httpsRequest;
    const req = lib(
      parsed,
      {
        method,
        headers: {
          "User-Agent": UA,
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      },
    );
    req.on("error", () => resolve(""));
    req.on("timeout", () => {
      req.destroy();
      resolve("");
    });
    if (body) req.write(body);
    req.end();
  });
}
