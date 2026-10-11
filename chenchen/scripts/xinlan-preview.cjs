"use strict";
// Local static preview only. No financial APIs or authentication are implemented here.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../versions");
const files = new Set(["xinlan/index.html", "xinlan/workspace.css", "xinlan/workspace.js", "xinlan/model.mjs", "xinlan/mark.svg", "style.css"]);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
function createPreviewServer() {
  return http.createServer((request, response) => {
    const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" };
    if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405, headers); response.end(); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname); } catch { response.writeHead(400, headers); response.end(); return; }
    if (pathname === "/") { response.writeHead(302, { ...headers, Location: "/xinlan/index.html" }); response.end(); return; }
    const key = pathname.replace(/^\//, "");
    if (!files.has(key)) { response.writeHead(404, headers); response.end("Not found"); return; }
    fs.readFile(path.join(root, key), (error, data) => {
      if (error) { response.writeHead(500, headers); response.end("Preview file unavailable"); return; }
      response.writeHead(200, { ...headers, "Content-Type": types[path.extname(key)] });
      response.end(request.method === "HEAD" ? undefined : data);
    });
  });
}
if (require.main === module) {
  const port = Number(process.env.PORT || 4318);
  createPreviewServer().listen(port, "127.0.0.1", () => console.log("Xinlan local preview: http://127.0.0.1:" + port + "/xinlan/index.html"));
}
module.exports = { createPreviewServer };
