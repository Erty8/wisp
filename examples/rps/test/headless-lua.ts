// Plays the RPS headless journey in 32-bit Lua, with the compiled map bundle
// in two simulated clients, and prints the journey's result, then each
// client's messages as `pN: says TEXT`.
// Usage: lua build/headless/headless.lua build/map.lua WARCRAFT_D_TS
import { luaLockstep, readFile } from "wisp/src/headless/lua";
import { journeyLines, journeyProblems, runJourney } from "wisp/src/headless/journey";
import { RPS_JOURNEY, RPS_MAP } from "./journey";

declare const arg: Readonly<Record<number, string | undefined>>;

const bundle = arg[1];
const declarations = arg[2];
if (bundle === undefined || declarations === undefined) throw new Error("usage: lua headless.lua MAP_LUA WARCRAFT_D_TS");
const clients = luaLockstep(RPS_MAP, readFile(bundle), readFile(declarations));
const result = runJourney(clients, RPS_JOURNEY);
for (const line of journeyLines(result)) print(line);
for (const client of clients.clients) for (const message of client.messages) print(`p${client.slot}: says ${message}`);
if (journeyProblems(result) > 0) os.exit(1);
