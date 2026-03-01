import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { cwd } from "node:process";

const root = cwd();
const port = 4173;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8"
};

function resolvePath(urlPath) {
  const cleanPath = (urlPath.split("?")[0] || "/").replace(/^\/+/, "");
  const candidate = normalize(join(root, cleanPath || "browser/index.html"));
  if (!candidate.startsWith(root)) {
    return null;
  }
  return candidate;
}

const server = createServer(async (req, res) => {
  try {
    const path = resolvePath(req.url || "/");
    if (!path) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }

    const data = await readFile(path);
    const type = contentTypes[extname(path)] || "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

server.listen(port, () => {
  console.log(`Browser REPL server running at http://localhost:${port}/browser/index.html`);
});
