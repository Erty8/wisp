// The autochess map's commands, composed from Wisp's services.
// Usage (from the Wisp checkout): bun examples/autochess/scripts/autochess.ts COMMAND [ARGUMENTS]
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { runMainCli } from "wisp/scripts/wisp/cli";
import { type Command, UsageFailure, flagValues } from "wisp/scripts/wisp/command";
import { GameFiles } from "wisp/scripts/wisp/gameFiles";
import { type BuildProject, MapBuild } from "wisp/scripts/wisp/mapBuild";
import { SourceErrors } from "wisp/scripts/wisp/sourceErrors";
import type { MapDeclaration } from "wisp/scripts/mapInfo";

const chess = join(import.meta.dir, "..");
const root = join(chess, "../..");
const sourceDirectory = join(chess, "src");
const sourceMapDirectory = join(chess, "build/source-maps");
/** The map's configureRuntime() filePrefix in src/main.ts. */
const filePrefix = "autochess";
const NAME = "Wisp Autochess";

const project: BuildProject = {
  projectRoot: root,
  configPath: join(chess, "tsconfig.map.json"),
  bundlePath: join(chess, "build/map.lua"),
  compileInputs: [sourceDirectory, join(root, "src"), join(root, "plugins"), join(chess, "tsconfig.map.json")],
  packager: join(root, "build/tools/map-pack"),
  toolchainLockPath: join(root, "typescript-toolchain.lock"),
  packageDirectory: root,
};

const declaration: MapDeclaration = {
  author: "Wisp",
  description: "Buy units, place them on your board and survive 30 rounds of creeps. Type -shop to reopen the shop.",
  suggestedPlayers: "1-2",
  players: [{ id: 0, name: "Player 1" }, { id: 1, name: "Player 2" }],
  forces: [{ name: "Players", playerIds: [0, 1] }],
};

const mapServices = MapBuild.layer(project).pipe(
  Layer.provideMerge(SourceErrors.layer({ sourceMapDirectory, filePrefix })),
  Layer.provide(GameFiles.layer()),
);

const build: Command = (args) => Effect.gen(function*() {
  const [base] = flagValues(args, "base");
  const [out] = flagValues(args, "out");
  if (base === undefined || out === undefined) return yield* new UsageFailure({ problem: "build needs --base and --out" });
  yield* MapBuild.use((maps) => maps.build({ base, out, name: NAME, declaration }));
}).pipe(Effect.provide(mapServices));

runMainCli("bun examples/autochess/scripts/autochess.ts", {
  map: { usage: "build --base BASE.w3m --out OUT.w3x", load: async () => ([verb, ...args]) => verb === "build" ? build(args) : Effect.fail(new UsageFailure({ problem: "map takes build" })) },
  headless: {
    usage: "[rounds] [--clients N] [--json]",
    load: async () => {
      const { makeHeadless } = await import("wisp/scripts/wisp/commands/headless");
      return makeHeadless(async () => {
        const { CHESS_JOURNEY, CHESS_MAP } = await import("../test/journey");
        return { map: CHESS_MAP, entry: join(sourceDirectory, "main.ts"), journeys: { rounds: CHESS_JOURNEY } };
      });
    },
  },
}, process.argv.slice(2));
