"use strict";

process.env.PUBLIC_ACCESS = "true";
const { server } = require("../server");
const port = Number(process.env.PORT || 4175);
server.listen(port, "127.0.0.1", () => {
  console.log(`Portfolio Sentinel public demo running at http://127.0.0.1:${port}`);
});
