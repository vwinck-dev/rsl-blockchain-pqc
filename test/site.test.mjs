import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findPlaintext, packageSite } from "../scripts/lib/site.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "site-"));
  mkdirSync(join(root, "assets"));
  mkdirSync(join(root, "data"));
  writeFileSync(join(root, "index.html"), "<html></html>");
  writeFileSync(join(root, "assets", "app.js"), "console.log(1)");
  writeFileSync(join(root, "data", "studies.enc"), '{"v":1}');
  return root;
}

test("findPlaintext: clean output has no offenders", () => {
  assert.deepEqual(findPlaintext(fixture()), []);
});

test("findPlaintext: flags any .json file", () => {
  const root = fixture();
  writeFileSync(join(root, "data", "approved.json"), "[]");
  assert.equal(findPlaintext(root).length, 1);
});

test("findPlaintext: flags study fields hidden in other files", () => {
  const root = fixture();
  writeFileSync(join(root, "assets", "leak.txt"), '{"criterion_id": "1"}');
  assert.equal(findPlaintext(root).length, 1);
});

test("findPlaintext: flags fields of this fork's schema", () => {
  const root = fixture();
  writeFileSync(
    join(root, "assets", "leak.txt"),
    '{"criterio_parsifal": {"id": 1}, "motivo_parsifal": "x"}',
  );
  assert.equal(findPlaintext(root).length, 1);
});

test("packageSite: copies the site into dist", () => {
  const root = fixture();
  packageSite(root, join(root, "dist"));
  assert.ok(existsSync(join(root, "dist", "index.html")));
  assert.ok(existsSync(join(root, "dist", "data", "studies.enc")));
});

test("packageSite: fails without the encrypted data", () => {
  const root = fixture();
  rmSync(join(root, "data", "studies.enc"));
  assert.throws(() => packageSite(root, join(root, "dist")), /studies\.enc/);
});

test("packageSite: fails and reports plaintext found in the site", () => {
  const root = fixture();
  writeFileSync(join(root, "data", "approved.json"), "[]");
  assert.throws(() => packageSite(root, join(root, "dist")), /plaintext/i);
});
