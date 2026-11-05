import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasEncodingDamage, repairKnownVietnameseText, vietnameseRepairs } from "../scripts/lib/vietnamese-repairs.mjs";

test("Audited damaged addresses and notes restore the original Vietnamese without losing accents", () => {
  assert.equal(vietnameseRepairs.size, 6);
  for (const [before, after] of vietnameseRepairs) {
    assert.equal(hasEncodingDamage(before), true);
    assert.equal(repairKnownVietnameseText(before), after);
    assert.equal(hasEncodingDamage(after), false);
    assert.equal(repairKnownVietnameseText(after), after);
  }
  assert.equal(repairKnownVietnameseText("HUIT, T\uFFFDn Ph\uFFFD, TP. H? Ch\uFFFD Minh"), "HUIT, Tân Phú, TP. Hồ Chí Minh");
  assert.equal(repairKnownVietnameseText("Landmark 81, B\uFFFDnh Th?nh, TP. H? Ch\uFFFD Minh"), "Landmark 81, Bình Thạnh, TP. Hồ Chí Minh");
});
test("Valid Vietnamese, names, punctuation and unrelated text remain unchanged", () => {
  for (const value of ["Nguyễn Minh Anh", "Đỗ Anh Dũng", "Ân và Ãnh", "Sân bay quốc tế Tân Sơn Nhất", "Bạn có muốn khóa tài xế?", "Điểm đón / Điểm đến", "Ghi chú chưa xác định", "123.456 ₫", null, 123]) {
    assert.equal(hasEncodingDamage(value), false); assert.equal(repairKnownVietnameseText(value), value);
  }
  const unknown = "Một đoạn ch\uFFFD bị mất";
  assert.equal(hasEncodingDamage(unknown), true); assert.equal(repairKnownVietnameseText(unknown), unknown);
});
test("UTF-8 decoded as Latin-1/Windows-1252 is detected and never blindly guessed", () => {
  const mojibake = Buffer.from("Địa điểm Tân Phú", "utf8").toString("latin1");
  assert.equal(hasEncodingDamage(mojibake), true); assert.equal(repairKnownVietnameseText(mojibake), mojibake);
});
test("All website source, styles, seed scripts and import files are valid UTF-8 without damaged display strings", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const problems = [];
  let scanned = 0;
  async function scan(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await scan(file);
      else if (/\.(tsx?|m?js|cjs|css|json|cql|csv)$/i.test(file)) {
        scanned++;
        let text;
        try { text = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(file)); }
        catch { problems.push(`${path.relative(root, file)}: invalid UTF-8`); continue; }
        if (hasEncodingDamage(text)) problems.push(`${path.relative(root, file)}: damaged characters`);
      }
    }
  }
  for (const directory of ["src", "scripts", "DULIEU", "migrations"]) await scan(path.join(root, directory));
  assert.ok(scanned > 50); assert.deepEqual(problems, []);
});
