// Minimal production server: bridges node:http to the Web-fetch handler that
// `vite build` emits for TanStack Start. Serves static client assets first.
import http from "node:http";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { Readable } from "node:stream";

const { logger, errorFields } = await import("../src/lib/log.ts");

// Fail at boot, with every problem listed, rather than on the first request.
try {
  const { validateEnv } = await import("../src/config/env.ts");
  const env = validateEnv();
  const { loadTheme } = await import("../src/theme/load.ts");
  const theme = loadTheme(env.themeDir, { explicit: env.themeDirExplicit });
  for (const w of theme.warnings) logger.warn("theme warning", { detail: w });
} catch (e) {
  logger.error("startup failed", errorFields(e));
  process.exit(1);
}

const handler = (await import("../dist/server/server.js")).default;
const clientDir = join(process.cwd(), "dist", "client");
const port = Number(process.env.PORT ?? 3003);

// Notification tick every 15 minutes in a child process (plain Node runs the .ts directly).
// Set NOTIFY_INTERVAL_MS=0 to disable when cron runs scripts/notify.ts instead.
const notifyEvery = Number(process.env.NOTIFY_INTERVAL_MS ?? 15 * 60 * 1000);
if (notifyEvery > 0) {
  const runTick = () => {
    const child = spawn(process.execPath, ["scripts/notify.ts"], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", (e) => logger.error("notify tick failed", errorFields(e)));
  };
  setTimeout(runTick, 30_000);
  setInterval(runTick, notifyEvery);
}

const mime = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

http
  .createServer(async (req, res) => {
    try {
      // Both throw on hostile input (`/%c0%af`, a malformed Host); inside the try so a request
      // can never take the process down.
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const filePath = normalize(join(clientDir, decodeURIComponent(url.pathname)));
      if (
        filePath.startsWith(clientDir + sep) &&
        existsSync(filePath) &&
        statSync(filePath).isFile()
      ) {
        res.writeHead(200, {
          "content-type": mime[extname(filePath)] ?? "application/octet-stream",
          "cache-control": url.pathname.startsWith("/assets/")
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        });
        createReadStream(filePath).pipe(res);
        return;
      }

      const body = req.method === "GET" || req.method === "HEAD" ? undefined : Readable.toWeb(req);
      const headers = Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v]),
      );
      // The peer address as this process sees it, for the rate limiter; always overwritten here.
      headers["x-sota-remote-addr"] = req.socket.remoteAddress ?? "";
      const request = new Request(url, {
        method: req.method,
        headers,
        body,
        duplex: body ? "half" : undefined,
      });
      const response = await handler.fetch(request);
      // `Object.fromEntries` keeps one value per name; Set-Cookie must stay a list.
      const out = Object.fromEntries(response.headers.entries());
      const cookies = response.headers.getSetCookie();
      if (cookies.length) out["set-cookie"] = cookies;
      res.writeHead(response.status, out);
      if (response.body) Readable.fromWeb(response.body).pipe(res);
      else res.end();
    } catch (e) {
      const bad = e instanceof URIError || (e instanceof TypeError && e.code === "ERR_INVALID_URL");
      if (!bad) logger.error("unhandled request error", errorFields(e));
      if (!res.headersSent)
        res.writeHead(bad ? 400 : 500).end(bad ? "bad request" : "internal error");
      else res.end();
    }
  })
  .listen(port, () => logger.info("listening", { port }));
