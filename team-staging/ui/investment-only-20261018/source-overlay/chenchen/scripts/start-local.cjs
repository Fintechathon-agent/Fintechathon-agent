"use strict";

const fs = require("node:fs");
const path = require("node:path");
const envFile = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
if (process.env.PUBLIC_ACCESS === "true") {
  console.error("本地 AI 联调服务不允许启用 PUBLIC_ACCESS。");
  process.exit(1);
}
const { server } = require("../server");
const port = Number(process.env.PORT || 4175);
server.on("error", error => {
  console.error(error.code === "EADDRINUSE" ? "端口已被占用，请停止旧服务后重试。" : "本地服务启动失败，请检查端口配置。");
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => console.log("昕澜本地联调：http://127.0.0.1:" + server.address().port + "/investment"));
