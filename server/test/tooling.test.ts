import { expect, test } from "bun:test";
import { assertRuntime, readConfig } from "../src/config.js";

test("runtime pin, port validation and local licensed SDK distribution", async () => {
  const sdkModule = new URL("../../scripts/embed-colyseus-sdk.mjs", import.meta.url).href;
  const { buildSdkBlock } = await import(sdkModule);
  assertRuntime();
  expect(readConfig({ PORT: "12345" })).toEqual({ port: 12345, hostname: "0.0.0.0", rankedEnabled: false, signInProviders: ['email'] });
  expect(() => readConfig({ PORT: "0" })).toThrow();
  expect(() => readConfig({ PORT: "NaN" })).toThrow();
  const sdk = buildSdkBlock();
  expect(sdk).toContain("@colyseus/sdk 0.18.4");
  expect(sdk).toContain("MIT License");
  expect(sdk).toContain("original bundle SHA-256");
  expect(sdk.match(/<\/script/gi)).toHaveLength(1);
});
