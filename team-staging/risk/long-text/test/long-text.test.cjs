"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const { parse, parseAmount, parseDate, minor, isoDay } = require("../parser.cjs");
const { Sessions, binding, occurrences } = require("../service.cjs");
const { createServer } = require("../server.cjs");
const DAY = "2026-10-17", now = () => new Date(DAY + "T12:00:00+08:00");
const input = (text, extra = {}) => ({ text, as_of: DAY, data_mode: "FIXTURE", horizon_days: 90, ...extra });
const scenario = "我目前现金5万元，保底1万元。下个月5号交房租3500元，下个月20号交学费2万元。我想投资2万元。";
const errorCode = code => error => error.code === code;
function setup(text = scenario, profile = {}) {
  const store = new Sessions({ now }); let draft = store.create("alice", input(text));
  draft = store.correct("alice", { ...binding(draft), items: [], profile: { existing_holds_minor: 0, fees_minor: 0, ...profile } });
  return { store, draft };
}
function confirm(store, draft) { return store.confirm("alice", { ...binding(draft), reviewed_item_ids: draft.items.map(x => x.id), confirmed: true, nonoverlap_confirmed: true }); }

test("normalizes Chinese and numeric currency amounts without floating point drift", async t => {
  for (const [text, expected] of [ ["学费2万元", 2000000], ["房租三千五百元", 350000], ["现金一万二千元", 1200000], ["现金1.25万", 1250000], ["现金12,000.50元", 1200050], ["房租3500", 350000], ["保底0元", 0], ["费用0.29元", 29], ["现金一点五万元", 1500000] ]) {
    await t.test(text, () => assert.equal(parseAmount(text).amount_minor, expected));
  }
});
test("ambiguous, negative, foreign, imprecise and multiple amounts remain unknown", async t => {
  for (const text of ["房租一万二", "房租-3000元", "房租3000美元", "房租3000或4000元", "房租3000到4000元", "房租大概3000元", "房租0.001元", "现金99999999999999元", "房租改成3500原来3000元"]) {
    await t.test(text, () => assert.equal(parseAmount(text).amount_minor, null));
  }
});
test("dates, weekdays, percentages and counts are not payment amounts", async t => {
  for (const text of ["下周三交学费", "2026-11-05交房租", "每月5号交房租", "三天后付学费", "投资收益率5%", "分12期", "第一个计划"]) {
    await t.test(text, () => assert.equal(parseAmount(text).amount_minor, null));
  }
});
test("calendar parsing is explicit for relative, absolute, weekly and month-end dates", async t => {
  for (const [text, due] of [["明天", "2026-10-18"], ["下个月5号", "2026-11-05"], ["下周三", "2026-10-21"], ["三天后", "2026-10-20"], ["月底", "2026-10-31"], ["下月底", "2026-11-30"], ["2026年11月20日", "2026-11-20"], ["明年1月1日", "2027-01-01"], ["下个月", null], ["近期", null], ["2026-02-30", null], ["下月32号", null]]) {
    await t.test(text, () => assert.equal(parseDate(text, DAY).due_date, due));
  }
});
test("monthly occurrences recover the original day after short months", () => {
  const parsed = parseDate("每月31号房租", "2027-01-31");
  const rows = occurrences({ ...parsed, id: "rent", amount_minor: 100 }, "2027-04-30");
  assert.deepEqual(rows.map(x => x.at), ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
  const leap = parseDate("每月31号房租", "2028-02-01");
  assert.equal(leap.due_date, "2028-02-29");
  assert.equal(occurrences({ ...leap, id: "r" }, "2028-03-31")[1].at, "2028-03-31");
});
test("splits coordinated obligations and keeps precise emoji/full-width source offsets", () => {
  const text = "💬我现金８万元；明天交房租3500元和学费20000元。";
  const draft = parse(input(text), now);
  assert.equal(draft.items.length, 3);
  assert.deepEqual(draft.items.map(x => x.amount_minor), [8000000, 350000, 2000000]);
  for (const item of draft.items) assert.equal(text.slice(item.source_span.start, item.source_span.end), item.text);
});
test("completed, cancelled, third-party and illiquid assets are separated", () => {
  const draft = parse(input("我学费6000元已经交了。朋友下月5号要交房租3000元。持有基金5万元。取消了会员。没有取消会员。"), now);
  assert.deepEqual(draft.items.map(x => x.disposition), ["EXCLUDE", "EXCLUDE", "EXCLUDE", "EXCLUDE", "UNRESOLVED"]);
  assert.equal(draft.profile.cash_minor, null);
});
test("conditions and corrections cannot silently become confirmed obligations", () => {
  const draft = parse(input("如果工资8000元到账，再买基金5000元。房租3000元，改成3500元。"), now);
  assert.equal(draft.items[0].disposition, "UNRESOLVED");
  assert.equal(draft.items[1].disposition, "UNRESOLVED");
  assert.equal(draft.items.at(-1).classification.status, "CORRECTION");
  assert.equal(draft.items.at(-1).disposition, "UNRESOLVED");
});
test("voice interim transcript, blank input, wrong modes and oversized input reject", () => {
  assert.throws(() => parse(input("房租", { channel: "speech_transcript", is_final: false }), now), errorCode("TRANSCRIPT_NOT_FINAL"));
  assert.equal(parse(input("房租", { channel: "speech_transcript", is_final: true }), now).items.length, 1);
  for (const text of ["", " ", null, "字".repeat(20001), "房租。".repeat(81)]) assert.throws(() => parse(input(text), now));
  assert.throws(() => parse(input("房租", { data_mode: "LIVE" }), now), errorCode("DEMO_MODE_REQUIRED"));
  assert.throws(() => parse(input("房租", { horizon_days: 366 }), now), errorCode("INVALID_HORIZON"));
});
test("unknown cash, reserve, fees and existing holds never default to zero", () => {
  const store = new Sessions({ now }), draft = store.create("alice", input("明天交房租3000元。"));
  assert.equal(draft.profile.cash_minor, null);
  assert.equal(draft.profile.hard_floor_minor, null);
  assert.equal(draft.questions.length, 4);
  assert.throws(() => confirm(store, draft), errorCode("MISSING_INFORMATION"));
});
test("cash conflict uses the existing daily policy with hand-calculated integers", () => {
  const { store, draft } = setup(); const result = confirm(store, draft).result;
  assert.equal(result.decision, "BLOCK");
  assert.equal(result.risk_level, "high");
  assert.equal(result.metrics.expense_total_minor, 2350000);
  assert.equal(result.metrics.available_for_new_action_minor, 1650000);
  assert.equal(result.metrics.projected_free_after_minor, -350000);
  assert.equal(result.metrics.shortfall_minor, 350000);
  assert.ok(result.review.reasons.some(x => x.code === "PROTECTED_PURPOSE_CONFLICT"));
  assert.equal(result.execution_allowed, false);
  assert.equal(result.review.execution_allowed, false);
});
test("sufficient cash and explicit zero reserve preserve valid zero values", () => {
  const { store, draft } = setup(scenario, { cash_minor: 8000000, hard_floor_minor: 0 });
  const result = confirm(store, draft).result;
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.metrics.projected_free_after_minor, 3650000);
  assert.equal(result.review.gate, "WAITING_APPROVAL");
});
test("monthly rent is protected once per occurrence instead of once per paragraph", () => {
  const { store, draft } = setup("现金8万元，保底1万元，每月5号房租3500元，想投资2万元。");
  const result = confirm(store, draft).result;
  assert.equal(result.scheduled_expenses.length, 3);
  assert.equal(result.metrics.expense_total_minor, 1050000);
  assert.equal(result.metrics.available_for_new_action_minor, 5950000);
});
test("salary forecast does not increase today's investment capacity", () => {
  const { store, draft } = setup(scenario + "下个月10号工资8000元。");
  const result = confirm(store, draft).result;
  assert.equal(result.metrics.available_for_new_action_minor, 1650000);
  assert.equal(result.metrics.expected_income_minor, 800000);
  assert.equal(result.decision, "BLOCK");
});
test("uncertain income stays out of current and expected cash totals", () => {
  const { store, draft } = setup(scenario + "下个月10号可能有奖金8000元。");
  const income = draft.items.find(x => x.type === "INCOME" && x.certainty === "UNCERTAIN");
  assert.equal(income.disposition, "UNRESOLVED");
  const reviewed = store.correct("alice", { ...binding(draft), items: [{ id: income.id, disposition: "INCLUDE" }] });
  const result = confirm(store, reviewed).result;
  assert.equal(result.metrics.expected_income_minor, 0);
  assert.equal(result.uncertain_income_excluded.length, 1);
});
test("same-day income requires reconciliation with opening cash", () => {
  const { store, draft } = setup("现金8万元，保底0元，今天工资8000元，想投资100元。");
  const result = confirm(store, draft).result;
  assert.equal(result.decision, "REVIEW");
  assert.ok(result.review.reasons.some(x => x.code === "SHARED_FUNDS_RECONCILIATION_REQUIRED"));
});
test("existing holds, fees and combined investments are all included", () => {
  const { store, draft } = setup("现金5万元，保底1万元，想投资2万元。还想买基金2万元。", { existing_holds_minor: 10000, fees_minor: 1000 });
  const result = confirm(store, draft).result;
  assert.equal(result.metrics.requested_investment_minor, 4000000);
  assert.equal(result.metrics.shortfall_minor, 11000);
  assert.equal(result.decision, "BLOCK");
});
test("completed expenses are not charged twice", () => {
  const { store, draft } = setup("现金5万元，保底1万元，学费2万元已经交了，想投资2万元。");
  const result = confirm(store, draft).result;
  assert.equal(result.metrics.expense_total_minor, 0);
  assert.equal(result.metrics.projected_free_after_minor, 2000000);
});
test("unknown dates, overdue events and outside-window obligations must be resolved", () => {
  for (const suffix of ["下月房租3500元", "2026-10-01房租3500元", "2027-10-01学费2万元"]) {
    const { store, draft } = setup("现金8万元，保底1万元，想投资100元；" + suffix);
    assert.throws(() => confirm(store, draft), errorCode("MISSING_INFORMATION"));
  }
});
test("confirmation covers every candidate and nonoverlap; it never grants execution", () => {
  const { store, draft } = setup();
  const args = { ...binding(draft), confirmed: true, nonoverlap_confirmed: true, reviewed_item_ids: draft.items.map(x => x.id) };
  for (const patch of [{ confirmed: false }, { nonoverlap_confirmed: false }, { reviewed_item_ids: [] }, { reviewed_item_ids: [...args.reviewed_item_ids, args.reviewed_item_ids[0]] }])
    assert.throws(() => store.confirm("alice", { ...args, ...patch }), errorCode("CONFIRMATION_REQUIRED"));
  const first = store.confirm("alice", args);
  assert.deepEqual(first, store.confirm("alice", args));
  assert.equal(first.audit.length, 3);
  assert.equal(first.confirmation.risk_approved, false);
});
test("atomic corrections invalidate confirmation and reject all stale actions", () => {
  const { store, draft } = setup(); const old = confirm(store, draft);
  const changed = store.correct("alice", { ...binding(old), items: [{ id: "item-4", amount_minor: 1000000 }] });
  assert.equal(changed.confirmation, null); assert.equal(changed.result, null);
  assert.throws(() => confirm(store, old), errorCode("STALE_DRAFT"));
  assert.throws(() => store.export("alice", binding(old)), errorCode("STALE_DRAFT"));
  assert.throws(() => store.reviewRequest("alice", binding(old)), errorCode("STALE_DRAFT"));
  assert.equal(confirm(store, changed).result.decision, "ALLOW");
  assert.equal(changed.source_text, scenario);
});
test("invalid correction batches do not partially alter a draft", () => {
  const { store, draft } = setup();
  assert.throws(() => store.correct("alice", { ...binding(draft), items: [{ id: "item-4", amount_minor: 0 }, { id: "does-not-exist", amount_minor: 5 }] }), errorCode("INVALID_ITEM"));
  assert.deepEqual(store.export("alice", binding(draft)), draft);
});
test("malformed input cannot inject authority, overflow, or mutable result state", () => {
  const { store, draft } = setup();
  for (const value of [true, -1, 0.1, "0", Infinity, NaN, 1e20]) assert.throws(() => minor(value));
  assert.throws(() => isoDay("2026-02-30"));
  assert.throws(() => store.correct("alice", { ...binding(draft), items: [], profile: { risk_approved: true } }), errorCode("INVALID_FIELDS"));
  assert.throws(() => store.correct("alice", { ...binding(draft), items: [{ id: "item-4", type: "REAL_TRADE" }] }), errorCode("INVALID_TYPE"));
  assert.throws(() => store.confirm("alice", { ...binding(draft), execution_allowed: true }), errorCode("INVALID_FIELDS"));
  const confirmed = confirm(store, draft); confirmed.result.execution_allowed = true;
  assert.equal(store.export("alice", binding(confirmed)).result.execution_allowed, false);
});
test("owner isolation and expiration apply to export, correction and review", () => {
  let ms = now().getTime(); const store = new Sessions({ now: () => new Date(ms), ttlMs: 100, capacity: 1 });
  const draft = store.create("alice", input(scenario));
  assert.throws(() => store.export("bob", binding(draft)), errorCode("NOT_FOUND"));
  assert.throws(() => store.create("bob", input(scenario)), errorCode("CAPACITY"));
  ms += 100;
  assert.throws(() => store.export("alice", binding(draft)), errorCode("NOT_FOUND"));
  assert.ok(store.create("alice", input(scenario)).draft_id);
});
test("existing model-review contract accepts the verified request without granting authority", () => {
  const { store, draft } = setup(); const done = confirm(store, draft);
  const output = store.reviewRequest("alice", binding(done));
  assert.equal(output.submitted, false);
  assert.equal(output.request.schema_version, "model-review.v1");
  assert.equal(output.request.memory_consent, false);
  assert.equal(output.request.allow_rule_fallback, false);
  assert.equal(output.request.capability, "REVIEW_ONLY");
  assert.deepEqual(output.request.action_parameters, {});
});
test("pinned risk dependency matches recorded hashes", () => {
  const root = require("node:path").join(__dirname, "../vendor"), manifest = require("../vendor/provenance.json");
  for (const [file, entry] of Object.entries(manifest.files)) assert.equal(createHash("sha256").update(fs.readFileSync(require("node:path").join(root, file))).digest("hex"), entry.vendored_sha256);
});

async function serve(t, options = {}) {
  const server = createServer(options);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = "http://127.0.0.1:" + server.address().port;
  const init = await fetch(base + "/"); const cookie = init.headers.get("set-cookie").split(";")[0];
  const post = async (route, body, customCookie = cookie) => fetch(base + "/api/long-text/v1/" + route, { method: "POST", headers: { "Content-Type": "application/json", Cookie: customCookie }, body: JSON.stringify(body) });
  return { base, post, cookie };
}
test("HTTP complete parse → correction → confirm → result → export → revision flow", async t => {
  const { base, post } = await serve(t, { env: {} });
  const html = await (await fetch(base)).text(); assert.match(html, /生活资金/);
  for (const asset of ["/app.js", "/style.css"]) assert.equal((await fetch(base + asset)).status, 200);
  let draft = await (await post("intake", input(scenario))).json();
  assert.equal((await post("export", binding(draft), "long_text_session=" + "a".repeat(64))).status, 404);
  draft = await (await post("correct", { ...binding(draft), items: [], profile: { existing_holds_minor: 0, fees_minor: 0 } })).json();
  draft = await (await post("confirm", { ...binding(draft), confirmed: true, nonoverlap_confirmed: true, reviewed_item_ids: draft.items.map(x => x.id) })).json();
  assert.equal(draft.result.decision, "BLOCK");
  assert.equal((await (await post("export", binding(draft))).json()).result.metrics.shortfall_minor, 350000);
  assert.equal((await post("model-review", binding(draft))).status, 503);
  const revised = await (await post("revise", { ...binding(draft), text: scenario.replace("2万元。", "1万元。"), as_of: DAY, horizon_days: 90 })).json();
  assert.equal(revised.confirmation, null);
  assert.equal((await post("export", binding(draft))).status, 409);
});
test("HTTP rejects cross-origin, invalid JSON, huge input and forged business fields", async t => {
  const { base, post } = await serve(t);
  assert.equal((await fetch(base, { headers: { Origin: "https://attacker.invalid" } })).status, 403);
  const hostStatus = await new Promise((resolve, reject) => http.get(base, { headers: { Host: "attacker.invalid" } }, r => { r.resume(); r.on("end", () => resolve(r.statusCode)); }).on("error", reject));
  assert.equal(hostStatus, 403);
  assert.equal((await fetch(base + "/api/long-text/v1/intake", { method: "POST", body: "{}" })).status, 415);
  assert.equal((await fetch(base + "/api/long-text/v1/intake", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" })).status, 400);
  assert.equal((await post("intake", [])).status, 422);
  assert.equal((await post("intake", input("字".repeat(50000)))).status, 413);
  assert.equal((await post("intake", { ...input(scenario), risk_approved: true })).status, 422);
  assert.equal((await fetch(base + "/../../AGENTS.md")).status, 404);
});

test("cross-site document links can open the blank page but cannot access APIs", async t => {
  const { base } = await serve(t);
  const get = url => new Promise((resolve, reject) => http.get(url, { headers: { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" } }, r => { r.resume(); r.on("end", () => resolve(r.statusCode)); }).on("error", reject));
  assert.equal(await get(base + "/"), 200);
  assert.equal(await get(base + "/api/long-text/v1/health"), 403);
});
test("provider failures stay failures and redact provider secrets", async t => {
  const { post } = await serve(t, { env: { LONG_TEXT_MODEL_REVIEW: "1" }, modelRunner: async () => { throw Error("secret-provider-token"); } });
  let draft = await (await post("intake", input(scenario))).json();
  draft = await (await post("correct", { ...binding(draft), items: [], profile: { existing_holds_minor: 0, fees_minor: 0 } })).json();
  draft = await (await post("confirm", { ...binding(draft), confirmed: true, nonoverlap_confirmed: true, reviewed_item_ids: draft.items.map(x => x.id) })).json();
  const response = await post("model-review", binding(draft));
  assert.equal(response.status, 502); assert.doesNotMatch(await response.text(), /secret-provider-token/);
  assert.equal((await (await post("export", binding(draft))).json()).result.decision, "BLOCK");
});
test("in-flight model response cannot attach to a revised draft", async t => {
  let finish, started;
  const signal = new Promise(resolve => { started = resolve; });
  const { post } = await serve(t, { env: { LONG_TEXT_MODEL_REVIEW: "1" }, modelRunner: async () => { started(); return new Promise(resolve => { finish = resolve; }); } });
  let draft = await (await post("intake", input(scenario))).json();
  draft = await (await post("correct", { ...binding(draft), items: [], profile: { existing_holds_minor: 0, fees_minor: 0 } })).json();
  draft = await (await post("confirm", { ...binding(draft), confirmed: true, nonoverlap_confirmed: true, reviewed_item_ids: draft.items.map(x => x.id) })).json();
  const pending = post("model-review", binding(draft)); await signal;
  assert.equal((await post("model-review", binding(draft))).status, 409);
  await post("correct", { ...binding(draft), items: [], profile: { cash_minor: 8000000 } });
  finish({ source: "TEST_DOUBLE" }); assert.equal((await pending).status, 409);
});
