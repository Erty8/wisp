// The RPS map's compiled bundle in two simulated clients of the 32-bit Lua
// that LUA names (wisp:docs/headless.md). The map calls Warcraft's natives
// directly, which a map on Bun doesn't get, so its journey runs only in Lua.
import { expect } from "bun:test";
import { join } from "node:path";
import { mapCompiler, report } from "wisp/scripts/compiler";
import { farmTest } from "wisp/scripts/wisp/farmTest";

const rps = join(import.meta.dir, "..");

farmTest("both players recruit from their quartermaster, down different choices, pick a race and hero by keys and clicks, learn and cast from the spell bar, swing and guard with the mouse and keys, walk, target, attack, switch stances, try their spells, walk with A and switch cameras, and take a hot reload, with the same native calls in both clients", () => {
  expect(report(mapCompiler(join(rps, "tsconfig.map.json"))())).toBe("");
  expect(report(mapCompiler(join(rps, "tsconfig.headless.json"))())).toBe("");
  const run = Bun.spawnSync([
    process.env.LUA ?? "lua", join(rps, "build/headless/headless.lua"),
    join(rps, "build/map.lua"), join(rps, "../../src/natives/warcraft.d.ts"),
  ], { stdout: "pipe", stderr: "pipe" });
  const lines = run.stdout.toString().trimEnd().split(/\r?\n/);
  expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  const [first, second] = lines;
  expect(first?.replace(/^p0/, "")).toBe(second?.replace(/^p1/, ""));
  expect(lines).toContain("no desync in 1000 frames");
  // A script error in a trigger stops what it was doing without failing the run: none may happen.
  expect(lines.filter((line) => line.includes("error in"))).toEqual([]);
  expect(lines).toContain("hot reload 1 running in every client");
  expect(lines.filter((line) => line.startsWith("p0: says WASD moves the Mountain King"))).toHaveLength(1);
  expect(lines.filter((line) => line.startsWith("p1: says WASD moves the Archmage"))).toHaveLength(1);
  expect(lines).toContain("p0: says No visible enemy within 900.");
  expect(lines).toContain("p0: says Stance: Tight Guard. The squad stays by the hero.");
  expect(lines).toContain("p1: says No target: press Tab first.");
  expect(lines).toContain("p1: says Stance: Vanguard. Melee in front, ranged behind.");
  expect(lines.some((line) => line.startsWith("p1: says No visible enemy"))).toBe(false);
  expect(lines).toContain("p0: says No target: press Tab first.");
  expect(lines).toContain("p0: says Thunder Clap can't be cast now: not learned, recharging or out of mana.");
  expect(lines).toContain("p1: says Brilliance Aura is passive.");
  expect(lines).toContain("p0: says No skill points to spend.");
  expect(lines).toContain("p0: says Animation 3.");
  expect(lines).toContain("p0: says Swings land 8 ticks in (240 ms).");
  expect(lines).toContain("p1: says Guard pose: animation 5, frozen 6 ticks in.");
  // The quartermaster: player 1 hires Footmen; player 2 hires Riflemen, then can't hire them twice.
  expect(lines).toContain("p0: says Two Footmen join you.");
  expect(lines).toContain("p1: says Two Riflemen join you.");
  expect(lines).toContain("p1: says You already lead Riflemen.");
  expect(lines.some((line) => line.startsWith("p0: says Two Riflemen"))).toBe(false);
  expect(lines).toContain("p1: says Swings play animations 4, 5, 6.");
  expect(lines).toContain("p1: says Blizzard can't be cast now: not learned, recharging or out of mana.");
  expect(lines).toContain("p1: says No target: press Tab first.");
  expect(lines).toContain("p0: says Camera: Shoulder (distance 420, angle -10, field of view 70).");
  expect(lines).toContain("p1: says Camera: Tactical (distance 1300, angle -38, field of view 80).");
}, 60_000);
