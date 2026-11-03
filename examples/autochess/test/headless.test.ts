// The autochess map in two simulated clients (wisp:docs/headless.md): its
// TypeScript in Bun, then its compiled bundle in the 32-bit Lua that LUA
// names. Both clients make the same native calls, and the bundle makes the
// same calls in Lua as the TypeScript in Bun.
import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import { mapCompiler, report } from "wisp/scripts/compiler";
import { installHeadless } from "wisp/scripts/wisp/headless";
import { journeyLines, runJourney } from "wisp/src/headless/journey";
import { farmTest } from "wisp/scripts/wisp/farmTest";
import { install, start } from "../src/main";
import { CHESS_JOURNEY, CHESS_MAP } from "./journey";

const headless = installHeadless(CHESS_MAP);
afterAll(headless.restore);

const chess = join(import.meta.dir, "..");

function playInBun() {
  const clients = headless.clients({ start, install });
  return { clients, result: runJourney(clients, CHESS_JOURNEY) };
}

test("both clients shop, take a hot reload, fight round 1 and reach round 2, with the same native calls", () => {
  const { clients, result } = playInBun();
  expect(result.divergence).toBeUndefined();
  expect(result.reloads).toEqual([]);
  for (const client of clients.clients) {
    expect(client.errors).toEqual([]);
    expect(client.missingNatives).toEqual([]);
    const messages = client.messages.join("\n");
    expect(messages).toContain("Round 1: 30 seconds");
    expect(messages).toContain("Fight! 2 creeps against your 0 units.");
    expect(messages).toContain("2 creeps survived: you lose 4 health (96 left).");
    expect(messages).toContain("Round 2: 30 seconds");
  }
  const [first, second] = result.clients;
  expect(first?.calls).toBe(second?.calls);
  expect(first?.checksum).toBe(second?.checksum ?? "");
});

farmTest("the compiled bundle in 32-bit Lua makes the same native calls as the TypeScript in Bun", () => {
  expect(report(mapCompiler(join(chess, "tsconfig.map.json"))())).toBe("");
  expect(report(mapCompiler(join(chess, "tsconfig.headless.json"))())).toBe("");
  const run = Bun.spawnSync([
    process.env.LUA ?? "lua", join(chess, "build/headless/headless.lua"),
    join(chess, "build/map.lua"), join(chess, "../../src/natives/warcraft.d.ts"),
  ], { stdout: "pipe", stderr: "pipe" });
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(run.stdout.toString().trimEnd().split(/\r?\n/)).toEqual(journeyLines(playInBun().result));
});
