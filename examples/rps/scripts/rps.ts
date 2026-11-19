// The RPS map's commands, composed from Wisp's services.
// Usage (from the Wisp checkout): bun examples/rps/scripts/rps.ts COMMAND [ARGUMENTS]
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { runMainCli } from "wisp/scripts/wisp/cli";
import { type Command, UsageFailure, flagValues } from "wisp/scripts/wisp/command";
import { GameFiles } from "wisp/scripts/wisp/gameFiles";
import { type BuildProject, MapBuild } from "wisp/scripts/wisp/mapBuild";
import { SourceErrors } from "wisp/scripts/wisp/sourceErrors";
import type { MapDeclaration } from "wisp/scripts/mapInfo";

const rps = join(import.meta.dir, "..");
const root = join(rps, "../..");
const sourceDirectory = join(rps, "src");
const sourceMapDirectory = join(rps, "build/source-maps");
/** The map's configureRuntime() filePrefix in src/main.ts. */
const filePrefix = "rps";
const NAME = "Wisp RPS";

const project: BuildProject = {
  projectRoot: root,
  configPath: join(rps, "tsconfig.map.json"),
  bundlePath: join(rps, "build/map.lua"),
  compileInputs: [sourceDirectory, join(root, "src"), join(root, "plugins"), join(rps, "tsconfig.map.json")],
  packager: join(root, "build/tools/map-pack"),
  toolchainLockPath: join(root, "typescript-toolchain.lock"),
  packageDirectory: root,
};

/**
 * The map's Game Interface (war3mapSkin.txt): one [CustomSkin] section, as
 * World Editor's Game Interface writes it, pointing the console's four
 * textures and the inventory cover at Warcraft's transparent backdrop, so
 * the stone console draws nothing. (Per-race sections with six textures did
 * nothing in Warcraft; the [CustomSkin] form is the one a published map uses.)
 */
const BLANK = "UI\\Widgets\\EscMenu\\Human\\blank-background.blp";
const SKIN = [
  "[CustomSkin]",
  ...[1, 2, 3, 4].map((tile) => `ConsoleTexture0${tile}=${BLANK}`),
  `ConsoleInventoryCoverTexture=${BLANK}`,
  "",
].join("\r\n");
const interfaceFiles = [{ entry: "war3mapSkin.txt", contents: new TextEncoder().encode(SKIN) }];

const declaration: MapDeclaration = {
  author: "Wisp",
  description: "Pick a hero of your lobby race or the tavern and lead a squad: WASD moves, drag the right mouse to turn, click, Space or K attacks, Q guards, 1-4 cast, Z/X/C command the squad, E talks or picks up, I opens the inventory, G walks. Recruit at the race bases, take quests, hold outposts for gold.",
  suggestedPlayers: "1-2",
  players: [{ id: 0, name: "Player 1" }, { id: 1, name: "Player 2" }],
  // Rivals: each player is their own force, so they contest each other's outposts.
  forces: [{ name: "West", playerIds: [0] }, { name: "East", playerIds: [1] }],
};

const mapServices = MapBuild.layer(project).pipe(
  Layer.provideMerge(SourceErrors.layer({ sourceMapDirectory, filePrefix })),
  Layer.provide(GameFiles.layer()),
);

const build: Command = (args) => Effect.gen(function*() {
  const [base] = flagValues(args, "base");
  const [out] = flagValues(args, "out");
  if (base === undefined || out === undefined) return yield* new UsageFailure({ problem: "build needs --base and --out" });
  yield* MapBuild.use((maps) => maps.build({ base, out, name: NAME, declaration, objectData: interfaceFiles }));
}).pipe(Effect.provide(mapServices));

runMainCli("bun examples/rps/scripts/rps.ts", {
  map: { usage: "build --base BASE.w3m --out OUT.w3x", load: async () => ([verb, ...args]) => verb === "build" ? build(args) : Effect.fail(new UsageFailure({ problem: "map takes build" })) },
}, process.argv.slice(2));
