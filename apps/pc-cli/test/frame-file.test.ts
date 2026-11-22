import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { PixelFrame } from "@ambientlight/core";
import sharp from "sharp";
import { CliError } from "../src/cli.js";
import { saveFramePng } from "../src/frame-file.js";

describe("saveFramePng", () => {
  const save = async (frame: PixelFrame): Promise<number[]> => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "al-frame-"));
    try {
      const file = await saveFramePng(frame, path.join(dir, "frame.png"));
      // From a buffer: sharp keeps files it read by path open, and Windows then can't delete them.
      return [...(await sharp(fs.readFileSync(file)).raw().toBuffer())];
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it("saves GDI's BGRX bytes as RGB, ignoring the unused fourth byte", async () => {
    const data = Uint8Array.from([30, 20, 10, 0, 255, 128, 1, 0]);
    assert.deepEqual(await save({ data, width: 2, height: 1, channels: 4, order: "bgr" }), [10, 20, 30, 1, 128, 255]);
  });

  it("saves RGB frames unchanged", async () => {
    const data = Uint8Array.from([10, 20, 30, 1, 128, 255]);
    assert.deepEqual(await save({ data, width: 2, height: 1, channels: 3 }), [...data]);
  });

  it("reports a path it can't write to", async () => {
    const file = path.join(os.tmpdir(), "al-no-such-folder", "frame.png");
    const frame: PixelFrame = { data: new Uint8Array(3), width: 1, height: 1, channels: 3 };
    await assert.rejects(saveFramePng(frame, file), CliError);
  });
});
