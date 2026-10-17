"use strict";

const { draftReviewRequest } = require("./preview");

const result = draftReviewRequest({
  data_mode: "SYNTHETIC_REPLAY",
  text: "【虚构测试】我想再投入8,000元买基金，但下个月还要交房租4500元。双十一想买手机预算3000元；视频会员每月25元，不确定要不要续费。"
}, { now: () => new Date("2026-10-17T12:00:00+08:00") });

process.stdout.write(JSON.stringify(result, null, 2) + "\n");
