import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FrameAssembler } from "../src/gdi-capture.js";

const bytes = (...values: number[]): Buffer => Buffer.from(values);

describe("FrameAssembler", () => {
  it("returns a frame once enough bytes arrived, across chunks", () => {
    const assembler = new FrameAssembler(4);
    assert.deepEqual(assembler.push(bytes(1, 2)), []);
    assert.deepEqual(assembler.push(bytes(3)), []);
    assert.deepEqual(assembler.push(bytes(4)), [bytes(1, 2, 3, 4)]);
  });

  it("splits a chunk holding more than one frame and keeps the rest", () => {
    const assembler = new FrameAssembler(2);
    assert.deepEqual(assembler.push(bytes(1, 2, 3, 4, 5)), [bytes(1, 2), bytes(3, 4)]);
    assert.deepEqual(assembler.push(bytes(6)), [bytes(5, 6)]);
  });

  it("forgets a partial frame on reset", () => {
    const assembler = new FrameAssembler(2);
    assembler.push(bytes(9));
    assembler.reset();
    assert.deepEqual(assembler.push(bytes(1, 2)), [bytes(1, 2)]);
  });
});
