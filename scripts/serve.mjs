// Minimal static server for local development. Usage: npm run dev (or docker compose up dev)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".enc": "application/json",
};
const ROOT = process.cwd();
const PORT = Number(process.env.PORT ?? 8000);

createServer(async (req, res) => {
  const path = normalize(
    decodeURIComponent(new URL(req.url, "http://x").pathname),
  );
  const file = join(ROOT, path.endsWith("/") ? `${path}index.html` : path);
  if (
    !file.startsWith(ROOT) ||
    /\/(raw|src|deliverables|node_modules|\.git)\//.test(file)
  ) {
    res.writeHead(404).end("Not found");
    return;
  }
  try {
    // Read first: writeHead antes do await faria o catch reescrever headers e derrubar o servidor.
    const body = await readFile(file);
    res
      .writeHead(200, {
        "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      })
      .end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
