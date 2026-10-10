"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = __dirname;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".md": "text/plain; charset=utf-8" };
const port = Number(process.env.RISK_DEMO_PORT || 8767);
http.createServer((req, res) => {
  let name;
  try { name = decodeURIComponent(new URL(req.url, "http://localhost").pathname); } catch { res.writeHead(400).end(); return; }
  const target = path.resolve(root, `.${name === "/" ? "/index.html" : name}`);
  if (!target.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(target, (err, data) => {
    if (err) { res.writeHead(404).end("Not found"); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(target)] || "application/octet-stream", "Cache-Control": "no-store" }); res.end(data);
  });
}).listen(port, "127.0.0.1", () => process.stdout.write(`Risk prototype: http://127.0.0.1:${port}\n`));
