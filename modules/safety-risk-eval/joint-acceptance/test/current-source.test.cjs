"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { prepareCoreSnapshot, REPO_ROOT, sha256 } = require("../core-snapshot.cjs");

test("current-source acceptance snapshots every tracked runtime source and records its bytes", () => {
  const snapshot = prepareCoreSnapshot({ currentSource: true });
  try {
    assert.equal(snapshot.manifest.snapshot_mode, "CURRENT_TRACKED_WORKTREE");
    assert.ok(snapshot.manifest.source_sha256["chenchen/integrations/bailian-provider.js"]);
    assert.ok(snapshot.manifest.source_sha256["chenchen/integrations/service-security.js"]);
    for (const [file, digest] of Object.entries(snapshot.manifest.source_sha256)) {
      assert.equal(sha256(fs.readFileSync(path.join(REPO_ROOT, file))), digest);
      assert.equal(sha256(fs.readFileSync(path.join(snapshot.directory, file))), digest);
    }
    assert.equal(fs.existsSync(path.join(snapshot.directory, "chenchen/.env.local")), false);
  } finally { snapshot.dispose(); }
});
