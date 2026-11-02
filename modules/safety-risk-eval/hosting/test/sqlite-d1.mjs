import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
// Exercise the actual migration and SQL. This adapter is for local verification only.
export class SQLiteD1 {
  constructor(file = ":memory:") {
    this.db = new DatabaseSync(file);
    this.db.exec(fs.readFileSync(new URL("../drizzle/0000_lazy_human_cannonball.sql", import.meta.url), "utf8").replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS"));
    this.db.exec(fs.readFileSync(new URL("../drizzle/0001_model_budget.sql", import.meta.url), "utf8").replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS"));
  }
  prepare(sql) {
    const statement = this.db.prepare(sql);
    let values = [];
    const bindings = () => Object.fromEntries(values.map((value, i) => [`?${i + 1}`, value]));
    const query = {
      bind(...args) { values = args; return query; },
      async first() { return statement.get(bindings()) || null; },
      async run() { const result = statement.run(bindings()); return { success: true, meta: { changes: Number(result.changes) } }; }
    };
    return query;
  }
  close() { this.db.close(); }
}
