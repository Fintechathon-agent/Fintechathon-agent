import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
export const sessions = sqliteTable("risk_demo_sessions", {
  sessionId: text("session_id").primaryKey(),
  userId: text("user_id").notNull(),
  csrf: text("csrf").notNull(),
  payload: text("payload").notNull(),
  leaseOwner: text("lease_owner"),
  leaseUntil: integer("lease_until").notNull().default(0),
  revision: integer("revision").notNull().default(0),
  updatedAt: integer("updated_at").notNull()
});
