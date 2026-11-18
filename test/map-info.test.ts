// war3map.w3i format 31, as World Editor 1.31 to 1.35 saves it (the field
// order of a melee map saved by 1.35.0.19887, written out here with made-up
// values): a base map in that format reads, keeps its own bytes, and takes a
// map declaration without the race skins format 39 adds.
import { expect, test } from "bun:test";
import { declareMap, decodeMapInfo, encodeMapInfo, mapConfig, mapInfoFormat, supportedModes } from "../host/toolchain/mapInfo";

function writer() {
  const parts: number[] = [];
  const int = (value: number) => {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setInt32(0, value, true);
    parts.push(...bytes);
  };
  const float = (value: number) => {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setFloat32(0, value, true);
    parts.push(...bytes);
  };
  const string = (text: string) => parts.push(...new TextEncoder().encode(text), 0);
  const byte = (value: number) => parts.push(value);
  return { int, float, string, byte, bytes: () => new Uint8Array(parts) };
}

/** A two-slot melee map in format 31: Supported Modes 3 (SD and HD), start-location priorities set, one force. */
function format31(): Uint8Array {
  const w = writer();
  w.int(31); w.int(174); w.int(6115); w.int(1); w.int(35); w.int(0); w.int(19887);
  w.string("Arena"); w.string("Someone"); w.string("A melee map"); w.string("2");
  for (const bound of [-4096, -4096, 4096, 4096, -4096, 4096, 4096, -4096]) w.float(bound);
  for (let margin = 0; margin < 4; margin++) w.int(8);
  w.int(64); w.int(64);
  w.int(0xfc1c);
  // Environment: ground, loading screen, game data set, prologue, fog, weather, sound, light, water, script, modes, data version.
  w.byte(0x44); w.int(-1); w.string(""); w.string(""); w.string(""); w.string("");
  w.int(0); w.string(""); w.string(""); w.string(""); w.string("");
  w.int(0); w.float(3400); w.float(5200); w.float(0.5); w.int(0xffb9913f);
  w.int(0); w.string("Dungeon"); w.byte(0x4c); w.int(-1);
  w.int(1); w.int(3); w.int(1);
  // Players: id, controller, race, fixed start, name, x, y, ally low/high and enemy low/high priorities. No race skin.
  w.int(2);
  w.int(0); w.int(1); w.int(1); w.int(0); w.string("West"); w.float(-3000); w.float(2000); w.int(0); w.int(2); w.int(0); w.int(0);
  w.int(1); w.int(1); w.int(2); w.int(0); w.string("East"); w.float(3000); w.float(2000); w.int(0); w.int(1); w.int(0); w.int(0);
  w.int(1); w.int(0); w.int(-1); w.string("Force 1");
  // Upgrade, tech, random unit and random item tables: none.
  for (let table = 0; table < 4; table++) w.int(0);
  return w.bytes();
}

test("a format 31 map info reads its players and Supported Modes, and writes back byte for byte", () => {
  const bytes = format31();
  const info = decodeMapInfo(bytes);
  expect(mapInfoFormat(info)).toBe(31);
  expect(info.players.map(({ id, race, name, x, y }) => ({ id, race, name, x, y }))).toEqual([
    { id: 0, race: 1, name: "West", x: -3000, y: 2000 },
    { id: 1, race: 2, name: "East", x: 3000, y: 2000 },
  ]);
  expect(info.forces).toEqual([{ flags: 0, playerMask: -1, name: "Force 1" }]);
  expect(supportedModes(info.environment, 31)).toBe("both");
  expect(encodeMapInfo(info)).toEqual(bytes);
});

test("a format 31 base takes a map declaration: still format 31, no race skins, its priorities dropped", () => {
  const declared = declareMap(decodeMapInfo(format31()), "RPS", {
    author: "Wisp", description: "d", suggestedPlayers: "1-2", supportedModes: "hd",
    players: [{ id: 0, name: "Player 1" }, { id: 1, name: "Player 2" }],
    forces: [{ name: "West", playerIds: [0] }, { name: "East", playerIds: [1] }],
  });
  const reread = decodeMapInfo(encodeMapInfo(declared));
  expect(mapInfoFormat(reread)).toBe(31);
  expect(reread.players.map(({ name, x, y, priorities }) => ({ name, x, y, priorities }))).toEqual([
    { name: "Player 1", x: -3000, y: 2000, priorities: [0, 0, 0, 0] },
    { name: "Player 2", x: 3000, y: 2000, priorities: [0, 0, 0, 0] },
  ]);
  expect(supportedModes(reread.environment, 31)).toBe("hd");
  const config = mapConfig(reread);
  expect(config).toContain("DefineStartLocation(1, 3000.0, 2000.0)");
  expect(config).not.toContain("SetPlayerRaceSkin");
});

test("an unknown map info format is refused, naming the ones Wisp reads", () => {
  const bytes = format31();
  new DataView(bytes.buffer).setInt32(0, 28, true);
  expect(() => decodeMapInfo(bytes)).toThrow("war3map.w3i format 28 is not supported; expected 31 or 39");
});
