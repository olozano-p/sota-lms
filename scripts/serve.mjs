// Minimal production server: bridges node:http to the Web-fetch handler that
// `vite build` emits for TanStack Start. Serves static client assets first.
import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { Readable } from "node:stream";

const handler = (await import("../dist/server/server.js")).default;
const clientDir = join(process.cwd(), "dist", "client");
const port = Number(process.env.PORT ?? 3003);

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
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const filePath = normalize(join(clientDir, decodeURIComponent(url.pathname)));
    if (filePath.startsWith(clientDir) && existsSync(filePath) && statSync(filePath).isFile()) {
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
    const request = new Request(url, {
      method: req.method,
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v]),
      ),
      body,
      duplex: body ? "half" : undefined,
    });
    try {
      const response = await handler.fetch(request);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      if (response.body) Readable.fromWeb(response.body).pipe(res);
      else res.end();
    } catch (e) {
      console.error(e);
      res.writeHead(500).end("internal error");
    }
  })
  .listen(port, () => console.log(`lodro listening on http://localhost:${port}`));
