"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const csv = fs.readFileSync(path.join(root, "data", "sample-holdings.csv"), "utf8").trim();
const schema = JSON.parse(fs.readFileSync(path.join(root, "contracts", "holding-upload.v0.schema.json"), "utf8"));
const rows = csv.split(/\r?\n/).map((line) => line.split(","));
const expected = ["snapshot_date", "cash", "instrument_id", "name", "asset_type", "quantity", "current_price", "cost_basis"];
if (rows.length < 2 || rows[0].join(",") !== expected.join(",")) throw new Error("sample CSV header does not match the upload template");
const ids = new Set();
for (const [index, row] of rows.slice(1).entries()) {
  if (row.length !== expected.length) throw new Error("row " + (index + 2) + " has the wrong number of columns");
  if (ids.has(row[2])) throw new Error("duplicate instrument_id: " + row[2]);
  ids.add(row[2]);
  for (const column of [1, 5, 6]) if (!Number.isFinite(Number(row[column]))) throw new Error("row " + (index + 2) + " has an invalid number");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row[0])) throw new Error("row " + (index + 2) + " has an invalid snapshot date");
}
if (schema.properties.contract_version.const !== "holdings-intake.v0") throw new Error("unexpected holdings Contract version");
for (const file of ["index.html", "styles.css", "app.js"]) {
  const siteFile = path.join(root, "site", file);
  if (!fs.existsSync(siteFile) || fs.statSync(siteFile).size === 0) throw new Error("missing website file: " + file);
}
if (!fs.readFileSync(path.join(root, "site", "index.html"), "utf8").includes("confirmButton")) throw new Error("holdings website is missing confirmation flow");
console.log("Holdings Intake check passed: " + (rows.length - 1) + " sample rows validated.");
