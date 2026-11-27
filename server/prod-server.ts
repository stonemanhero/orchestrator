import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleApiRequest, scanProjects, getChromeProfiles } from "./orchestrator.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, "../dist");
const PORT = Number(process.env.MMM_PORT || 1420);

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];

  if (url.startsWith("/api/")) {
    handleApiRequest(req, res, url);
    return;
  }

  let filePath = path.join(DIST_DIR, url === "/" ? "index.html" : url);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, "index.html");
  }

  try {
    const ext = path.extname(filePath);
    const content = fs.readFileSync(filePath);
    res.statusCode = 200;
    res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
    res.end(content);
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
});

server.listen(PORT, "127.0.0.1", async () => {
  const projects = await scanProjects();
  const profiles = getChromeProfiles();
  const running = projects.filter((p) => p.isRunning).map((p) => p.name);
  console.log(`MMM Desktop Server listening on http://127.0.0.1:${PORT}`);
  console.log(`Discovered ${projects.length} projects (${running.length} running: ${running.join(", ") || "none"}) and ${profiles.length} Chrome profiles.`);
});
