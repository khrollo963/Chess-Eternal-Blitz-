import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { canonicalEngine } from "../src/engine.js";
import generatedDefault, { EnochianEngine } from "../src/generated/enochian-engine.mjs";

test("generated canonical engine imports natively and matches compiled production output", async () => {
  expect(process.versions.bun).toBe("1.4.2");
  expect(canonicalEngine).toBe(EnochianEngine);
  expect(generatedDefault).toBe(EnochianEngine);
  const source = readFileSync(new URL("../src/generated/enochian-engine.mjs", import.meta.url), "utf8");
  const hash = source.match(/Source SHA-256: ([a-f0-9]{64})/)?.[1];
  expect(hash).toHaveLength(64);

  // Build uses the approved compiler and checks freshness without regenerating
  // or modifying the canonical HTML/module owned by the client tasks.
  const extraction = spawnSync(process.execPath, ["../scripts/extract-enochian-engine.mjs", "--check"], { encoding: "utf8" });
  expect(extraction.status).toBe(0);
  const build = spawnSync(process.execPath, ["../scripts/run-server.mjs", "build"], { encoding: "utf8" });
  expect(build.status).toBe(0);
  const builtPath = new URL("../dist/generated/enochian-engine.mjs", import.meta.url);
  expect(readFileSync(builtPath, "utf8")).toContain(`Source SHA-256: ${hash}`);
  const { EnochianEngine: builtEngine } = await import(builtPath.href);
  const initial = canonicalEngine.initialState();
  const original = JSON.stringify(initial);
  expect(Object.keys(initial.board)).toHaveLength(36);
  expect(builtEngine.initialState()).toEqual(initial);
  const move = canonicalEngine.chooseAiMove(initial, "R", "easy", () => 0);
  expect(move).not.toBeNull();
  const successor = canonicalEngine.applyMove(initial, move);
  expect(builtEngine.applyMove(builtEngine.initialState(), move)).toEqual(successor);
  expect(successor.state.moveCount).toBe(1);
  expect(JSON.stringify(initial)).toBe(original);
  expect(readFileSync(new URL("../src/generated/enochian-engine.mjs", import.meta.url), "utf8")).toBe(source);
});
