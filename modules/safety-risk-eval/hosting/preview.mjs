import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SQLiteD1 } from "./test/sqlite-d1.mjs";
const artifact = path.resolve(process.argv[2] || "output/sites/risk-workbench/dist/server/index.js");
const worker = (await import(pathToFileURL(artifact).href)).default;
const db = new SQLiteD1();
const server = http.createServer(async (incoming, outgoing) => {
  try {
    const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
    const request = new Request(`http://127.0.0.1:8781${incoming.url}`, { method: incoming.method, headers: incoming.headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
    const response = await worker.fetch(request, { DB: db });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500); outgoing.end("Local preview error"); }
});
server.listen(8781, "127.0.0.1", () => console.log("Local: http://127.0.0.1:8781/risk"));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => { db.close(); process.exit(); }));
