"use strict";

process.env.PUBLIC_ACCESS = "true";
const { server } = require("../server");
const port = Number(process.env.PORT || 4175);
const host = process.env.HOST || "0.0.0.0";
server.listen(port, host, () => {
  console.log(`Portfolio Sentinel public demo running at http://${host}:${port}`);
});
