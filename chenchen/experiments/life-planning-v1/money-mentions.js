"use strict";

// Extract complete unverified monetary phrases, never executable amounts.
// Keep v0's recognizer unchanged so earlier demonstrations remain reproducible.
const NUMBER = String.raw`[-+]?(?:\d[\d,]*(?:\.\d+)?|\.\d+|[零〇一二两三四五六七八九十百千万亿]+)(?:万|千)?`;
const FRACTION_NUMBER = String.raw`(?:\d+|[零〇一二两三四五六七八九十百]+)`;
const FEN = String.raw`分(?!钟|之|秒|[\d零一二三四五六七八九十]+秒)`;
const UNIT = String.raw`(?:(?:元|块(?:钱)?)(?:\s*${FRACTION_NUMBER}角)?(?:\s*${FRACTION_NUMBER}${FEN})?|角(?:\s*${FRACTION_NUMBER}${FEN})?|${FEN})`;
const MONEY = new RegExp(String.raw`(?<![\d.,])(?:[¥￥]\s*${NUMBER}(?:\s*${UNIT})?|${NUMBER}\s*${UNIT})(?![\d.])`, "gu");

function extractMoneyMentions(text, offset = 0) {
  if (typeof text !== "string" || !Number.isSafeInteger(offset) || offset < 0) throw new TypeError("Invalid monetary source span");
  return [...text.matchAll(MONEY)].map(match => ({ text: match[0],
    source_span: { start: offset + match.index, end: offset + match.index + match[0].length }, status: "NEEDS_CONFIRMATION" }));
}

module.exports = { extractMoneyMentions };
