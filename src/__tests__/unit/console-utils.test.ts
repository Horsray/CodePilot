import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  copyTextToClipboard,
  formatConsoleEntryForCopy,
  getHighlightRanges,
  isConsoleEntryMatched,
  parseSearchKeywords,
  type SearchableConsoleEntry,
} from "../../lib/console-utils";

const sampleEntry: SearchableConsoleEntry = {
  id: 1,
  level: "error",
  message: "Request Timeout for /api/tasks",
  timestamp: new Date("2026-01-01T08:09:10.123Z").getTime(),
  source: "runtime",
};

describe("console-utils", () => {
  it("parses multi-keyword query with case-insensitive normalization", () => {
    assert.deepEqual(parseSearchKeywords("  Timeout   API  "), ["timeout", "api"]);
  });

  it("supports case-insensitive and partial keyword matching", () => {
    assert.equal(isConsoleEntryMatched(sampleEntry, ["timeout"]), true);
    assert.equal(isConsoleEntryMatched(sampleEntry, ["api", "request"]), true);
    assert.equal(isConsoleEntryMatched(sampleEntry, ["missing"]), false);
  });

  it("returns empty keyword list for blank query", () => {
    assert.deepEqual(parseSearchKeywords("   "), []);
    assert.equal(isConsoleEntryMatched(sampleEntry, []), true);
  });

  it("highlights multiple keywords and merges overlap ranges", () => {
    const ranges = getHighlightRanges("aaaa timeout aa", ["aa", "timeout"]);
    assert.deepEqual(ranges, [
      [0, 4],
      [5, 12],
      [13, 15],
    ]);
  });

  it("handles special characters and long logs", () => {
    const message = `${"x".repeat(6000)} [Error#500] payment_failed(user@site.com)`;
    const entry: SearchableConsoleEntry = {
      ...sampleEntry,
      id: 2,
      message,
    };
    assert.equal(isConsoleEntryMatched(entry, ["error#500", "payment_failed"]), true);
    const ranges = getHighlightRanges(message, ["error#500", "user@site"]);
    assert.equal(ranges.length, 2);
  });

  it("formats copied log content with timestamp level and source", () => {
    const copied = formatConsoleEntryForCopy(sampleEntry);
    assert.match(copied, /^\d{2}:\d{2}:\d{2}\.\d{3} \[error\] Request Timeout for \/api\/tasks \(runtime\)$/);
  });

  it("finishes fuzzy search for 10k logs within 100ms", () => {
    const entries: SearchableConsoleEntry[] = Array.from({ length: 10000 }, (_, index) => ({
      id: index,
      level: index % 3 === 0 ? "info" : "log",
      message: `worker-${index} build chunk ${index % 100}`,
      timestamp: index,
      source: "runtime",
    }));

    const keywords = parseSearchKeywords("worker-99 chunk");
    const start = Date.now();
    const matched = entries.filter((entry) => isConsoleEntryMatched(entry, keywords));
    const elapsed = Date.now() - start;

    assert.ok(matched.length > 0);
    assert.ok(elapsed <= 100, `expected <=100ms, got ${elapsed}ms`);
  });

  it("returns false for clipboard copy in non-browser runtime", async () => {
    const copied = await copyTextToClipboard("test");
    assert.equal(copied, false);
  });
});
