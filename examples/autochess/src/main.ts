// The autochess map's entry. Each player gets a board: buy units from the
// shop dialog, move them from the bench onto the south half of the board, and
// they fight the round's creeps. Three copies of a unit merge into a stronger
// one; walking a unit onto the circle of power sells it. The map's main()
// calls start() once; every hot reload calls the new bundle's install().
import { configureRuntime } from "wisp/src/runtime/config";
import { installDispatch, on, trampoline } from "wisp/src/map/dispatch";
import { installHotReload, startHotReload } from "wisp/src/map/hotReload";
import {
  BENCH_SIZE, LAST_ROUND, MAX_LEVEL, REROLL_COST, START_GOLD, START_HEALTH, START_LEVEL,
  damageFor, drawFrom, findMerge, income, kindAt, levelCost, nextSeed, rollShop, sellValue, starred, waveFor,
} from "./rules";

const SEATS = 2;
const CELL = 192;
const BOARD = 8 * CELL;
const HALF = 4 * CELL;
const QUARTER = 2 * CELL;
/** Each board's center is this far west (player 1) or east (player 2) of the map's center. */
const ARENA_OFFSET = 1664;
const CIRCLE_OF_POWER = 1852010352; // ncop
/** The timer's period is a quarter second. */
const PREP_SECONDS = 30;
const PREP_TICKS = 4 * PREP_SECONDS;
const COMBAT_TICKS = 240;

type Action = { readonly kind: "buy"; readonly slot: number } | { readonly kind: "reroll" | "level" | "close" };

interface Owned {
  unit: unit;
  readonly kind: number;
  readonly star: number;
}

interface Fighter {
  readonly owned: Owned;
  readonly x: number;
  readonly y: number;
}

interface Seat {
  readonly id: number;
  /** The board's southwest corner. */
  readonly x0: number;
  readonly y0: number;
  readonly dialog: dialog;
  gold: number;
  health: number;
  level: number;
  alive: boolean;
  offers: (number | undefined)[];
  pieces: Owned[];
  actions: Map<number, Action>;
  fighters: Fighter[];
  creeps: unit[];
  resolved: boolean;
}

/** Match state lives in a global, so a reloaded bundle continues it. */
interface ChessState {
  round: number;
  phase: "prep" | "combat" | "over";
  ticks: number;
  /** The match's random sequence (rules.ts nextSeed), the same in every client. */
  seed: number;
  readonly seats: Seat[];
}

declare global {
  var __chessState: ChessState | undefined;
}

function state(): ChessState {
  const current = globalThis.__chessState;
  if (current === undefined) throw new Error("autochess state used before start");
  return current;
}

const say = (seat: Seat, text: string) => DisplayTimedTextToPlayer(Player(seat.id), 0, 0, 8, text);
const sayAll = (text: string) => DisplayTextToForce(GetPlayersAll(), text);
const random = (low: number, high: number) => {
  const chess = state();
  chess.seed = nextSeed(chess.seed);
  return drawFrom(chess.seed, low, high);
};
const dead = (target: unit) => IsUnitType(target, UNIT_TYPE_DEAD);

/** The center of board square (`column`, `row`), rows counted from the south edge. */
const squareX = (seat: Seat, column: number) => seat.x0 + column * CELL + 96;
const squareY = (seat: Seat, row: number) => seat.y0 + row * CELL + 96;
const benchY = (seat: Seat) => seat.y0 - 288;
const padX = (seat: Seat) => seat.x0 + BOARD + 288;

const onOwnHalf = (seat: Seat, target: unit) => {
  const x = GetUnitX(target), y = GetUnitY(target);
  return x >= seat.x0 && x <= seat.x0 + BOARD && y >= seat.y0 && y <= seat.y0 + HALF;
};
const near = (target: unit, x: number, y: number, reach: number) =>
  Math.abs(GetUnitX(target) - x) <= reach && Math.abs(GetUnitY(target) - y) <= reach;

function applyStar(target: unit, star: number): void {
  if (star <= 1) return;
  const life = starred(BlzGetUnitMaxHP(target), star);
  BlzSetUnitMaxHP(target, life);
  SetUnitState(target, UNIT_STATE_LIFE, life);
  BlzSetUnitBaseDamage(target, starred(BlzGetUnitBaseDamage(target, 0), star), 0);
  const scale = star === 2 ? 1.25 : 1.5;
  SetUnitScale(target, scale, scale, scale);
}

function spawnPiece(seat: Seat, kind: number, star: number, x: number, y: number): unit {
  const piece = CreateUnit(Player(seat.id), kindAt(kind).id, x, y, 90.0);
  applyStar(piece, star);
  return piece;
}

function freeBenchSlot(seat: Seat): number | undefined {
  for (let slot = 0; slot < BENCH_SIZE; slot++) {
    const x = squareX(seat, slot);
    if (!seat.pieces.some((owned) => near(owned.unit, x, benchY(seat), 96))) return slot;
  }
  return undefined;
}

function mergeAll(seat: Seat): void {
  for (let found = findMerge(seat.pieces); found !== undefined; found = findMerge(seat.pieces)) {
    const members = found.map((index) => seat.pieces[index]).filter((owned): owned is Owned => owned !== undefined);
    const keep = members.find((owned) => onOwnHalf(seat, owned.unit)) ?? members[0];
    if (keep === undefined) return;
    const x = GetUnitX(keep.unit), y = GetUnitY(keep.unit);
    for (const owned of members) RemoveUnit(owned.unit);
    seat.pieces = seat.pieces.filter((owned) => !members.includes(owned));
    const kind = keep.kind, star = keep.star + 1;
    seat.pieces.push({ unit: spawnPiece(seat, kind, star, x, y), kind, star });
    say(seat, `${kindAt(kind).name} merged into ${star} stars!`);
  }
}

function showShop(seat: Seat): void {
  const round = state().round;
  DialogClear(seat.dialog);
  DialogSetMessage(seat.dialog, `Round ${round}  |  Gold ${seat.gold}  |  Level ${seat.level}  |  Health ${seat.health}`);
  seat.actions = new Map();
  const add = (text: string, action: Action) => seat.actions.set(GetHandleId(DialogAddButton(seat.dialog, text, 0)), action);
  seat.offers.forEach((offer, slot) => {
    if (offer !== undefined) add(`${kindAt(offer).name} (${kindAt(offer).cost} gold)`, { kind: "buy", slot });
  });
  add(`Reroll (${REROLL_COST} gold)`, { kind: "reroll" });
  if (seat.level < MAX_LEVEL) add(`Level up to ${seat.level + 1} (${levelCost(seat.level)} gold)`, { kind: "level" });
  add("Close (type -shop to reopen)", { kind: "close" });
  DialogDisplay(Player(seat.id), seat.dialog, true);
}

function buy(seat: Seat, slot: number): void {
  const offer = seat.offers[slot];
  if (offer === undefined) return;
  const kind = kindAt(offer);
  const bench = freeBenchSlot(seat);
  if (seat.gold < kind.cost) return say(seat, `${kind.name} costs ${kind.cost} gold.`);
  if (bench === undefined) return say(seat, "Your bench is full: move units onto the board or sell some.");
  seat.gold -= kind.cost;
  seat.offers[slot] = undefined;
  seat.pieces.push({ unit: spawnPiece(seat, offer, 1, squareX(seat, bench), benchY(seat)), kind: offer, star: 1 });
  mergeAll(seat);
}

function click(): void {
  const chess = state();
  const seat = chess.seats.find((candidate) => GetHandleId(candidate.dialog) === GetHandleId(GetClickedDialog()));
  const action = seat?.actions.get(GetHandleId(GetClickedButton()));
  if (seat === undefined || action === undefined || chess.phase !== "prep") return;
  if (action.kind === "close") return;
  if (action.kind === "buy") buy(seat, action.slot);
  if (action.kind === "reroll") {
    if (seat.gold < REROLL_COST) say(seat, `A reroll costs ${REROLL_COST} gold.`);
    else {
      seat.gold -= REROLL_COST;
      seat.offers = rollShop(seat.level, random);
    }
  }
  if (action.kind === "level") {
    const cost = levelCost(seat.level);
    if (seat.gold < cost) say(seat, `Level ${seat.level + 1} costs ${cost} gold.`);
    else {
      seat.gold -= cost;
      seat.level++;
      say(seat, `Level ${seat.level}: up to ${seat.level} units fight.`);
    }
  }
  showShop(seat);
}

function shopCommand(): void {
  const seat = state().seats.find((candidate) => candidate.id === GetPlayerId(GetTriggerPlayer()));
  if (seat === undefined || !seat.alive) return;
  if (state().phase === "prep") showShop(seat);
  else say(seat, "The shop opens after the fight.");
}

function startPrep(): void {
  const chess = state();
  chess.round++;
  chess.phase = "prep";
  chess.ticks = 0;
  for (const seat of chess.seats) {
    if (!seat.alive) continue;
    seat.gold += chess.round === 1 ? START_GOLD : income(seat.gold);
    seat.offers = rollShop(seat.level, random);
    say(seat, `Round ${chess.round}: ${PREP_SECONDS} seconds to buy and place units. Up to ${seat.level} units on the south half of your board fight.`);
    showShop(seat);
  }
}

function sellOnPad(seat: Seat): void {
  for (const owned of seat.pieces.filter((candidate) => near(candidate.unit, padX(seat), benchY(seat), 128))) {
    const value = sellValue(kindAt(owned.kind).cost, owned.star);
    seat.gold += value;
    RemoveUnit(owned.unit);
    seat.pieces = seat.pieces.filter((candidate) => candidate !== owned);
    say(seat, `Sold ${kindAt(owned.kind).name} for ${value} gold.`);
  }
}

function startCombat(): void {
  const chess = state();
  chess.phase = "combat";
  chess.ticks = 0;
  for (const seat of chess.seats) {
    if (!seat.alive) continue;
    DialogDisplay(Player(seat.id), seat.dialog, false);
    const onBoard = seat.pieces.filter((owned) => onOwnHalf(seat, owned.unit));
    for (const extra of onBoard.slice(seat.level)) {
      const bench = freeBenchSlot(seat);
      if (bench !== undefined) SetUnitPosition(extra.unit, squareX(seat, bench), benchY(seat));
    }
    if (onBoard.length > seat.level) say(seat, `Only ${seat.level} units fit at level ${seat.level}; the rest went back to the bench.`);
    seat.fighters = onBoard.slice(0, seat.level).map((owned) => ({ owned, x: GetUnitX(owned.unit), y: GetUnitY(owned.unit) }));
    seat.creeps = waveFor(chess.round).map((creep) => {
      const spawned = CreateUnit(Player(PLAYER_NEUTRAL_AGGRESSIVE), kindAt(creep.kind).id, squareX(seat, creep.column), squareY(seat, 4 + creep.row), 270.0);
      applyStar(spawned, creep.star);
      RemoveGuardPosition(spawned);
      SetUnitCreepGuard(spawned, false);
      UnitAddSleep(spawned, false);
      IssuePointOrder(spawned, "attack", seat.x0 + HALF, seat.y0 + QUARTER);
      return spawned;
    });
    for (const fighter of seat.fighters) IssuePointOrder(fighter.owned.unit, "attack", seat.x0 + HALF, seat.y0 + 3 * QUARTER);
    seat.resolved = false;
    say(seat, `Fight! ${seat.creeps.length} creeps against your ${seat.fighters.length} units.`);
  }
}

function resolve(seat: Seat): void {
  const chess = state();
  const survivors = seat.creeps.filter((creep) => !dead(creep)).length;
  const lost = damageFor(survivors, chess.round);
  seat.health -= lost;
  for (const creep of seat.creeps) RemoveUnit(creep);
  seat.creeps = [];
  for (const fighter of seat.fighters) {
    RemoveUnit(fighter.owned.unit);
    fighter.owned.unit = spawnPiece(seat, fighter.owned.kind, fighter.owned.star, fighter.x, fighter.y);
  }
  seat.fighters = [];
  seat.resolved = true;
  if (lost === 0) say(seat, `Round ${chess.round} won!`);
  else say(seat, `${survivors} creeps survived: you lose ${lost} health (${Math.max(seat.health, 0)} left).`);
  if (seat.health > 0) return;
  seat.alive = false;
  for (const owned of seat.pieces) RemoveUnit(owned.unit);
  seat.pieces = [];
  sayAll(`${GetPlayerName(Player(seat.id))} is out after round ${chess.round}.`);
}

/** The first tick, once loading is over: Warcraft doesn't draw a dialog shown during map initialization, but still greys out its menu. */
function begin(): void {
  FogEnable(false);
  FogMaskEnable(false);
  for (const seat of state().seats) {
    if (GetPlayerId(GetLocalPlayer()) === seat.id) PanCameraToTimed(seat.x0 + HALF, seat.y0 + QUARTER, 0);
  }
  sayAll("Autochess: buy units in the shop, move them onto the south half of your board, and survive 30 rounds. Walk a unit onto the circle of power to sell it.");
  startPrep();
}

function tick(): void {
  const chess = state();
  if (chess.phase === "over") return;
  if (chess.round === 0) return begin();
  for (const seat of chess.seats) SetPlayerState(Player(seat.id), PLAYER_STATE_RESOURCE_GOLD, Math.max(seat.gold, 0));
  chess.ticks++;
  if (chess.phase === "prep") {
    for (const seat of chess.seats) if (seat.alive) sellOnPad(seat);
    if (chess.ticks === PREP_TICKS - 40) sayAll("The fight starts in 10 seconds.");
    if (chess.ticks >= PREP_TICKS) startCombat();
    return;
  }
  for (const seat of chess.seats) {
    if (!seat.alive || seat.resolved) continue;
    const creepsLeft = seat.creeps.some((creep) => !dead(creep));
    const fightersLeft = seat.fighters.some((fighter) => !dead(fighter.owned.unit));
    if (!creepsLeft || !fightersLeft || chess.ticks >= COMBAT_TICKS) resolve(seat);
  }
  if (chess.seats.some((seat) => seat.alive && !seat.resolved)) return;
  const standing = chess.seats.filter((seat) => seat.alive);
  if (standing.length === 0 || chess.round >= LAST_ROUND) {
    chess.phase = "over";
    sayAll(standing.length === 0 ? "Game over: the creeps won." : `Victory! ${standing.map((seat) => GetPlayerName(Player(seat.id))).join(" and ")} survived all ${LAST_ROUND} rounds.`);
    return;
  }
  startPrep();
}

export function install(this: void): void {
  configureRuntime({ filePrefix: "autochess", readyPrefix: "AC_HRR", globalPrefix: "__chess" });
  installDispatch();
  on("chess.tick", tick);
  on("chess.click", click);
  on("chess.shop", shopCommand);
  installHotReload();
}

export function start(this: void): void {
  install();
  const centerX = GetRectCenterX(bj_mapInitialPlayableArea);
  const centerY = GetRectCenterY(bj_mapInitialPlayableArea);
  const seats: Seat[] = [];
  const clicks = CreateTrigger();
  const shop = CreateTrigger();
  for (let id = 0; id < SEATS; id++) {
    const player = Player(id);
    if (GetPlayerSlotState(player) !== PLAYER_SLOT_STATE_PLAYING || GetPlayerController(player) !== MAP_CONTROL_USER) continue;
    const seat: Seat = {
      id, x0: centerX + (id === 0 ? -ARENA_OFFSET : ARENA_OFFSET) - HALF, y0: centerY - HALF, dialog: DialogCreate(),
      gold: 0, health: START_HEALTH, level: START_LEVEL, alive: true,
      offers: [], pieces: [], actions: new Map(), fighters: [], creeps: [], resolved: true,
    };
    seats.push(seat);
    TriggerRegisterDialogEvent(clicks, seat.dialog);
    TriggerRegisterPlayerChatEvent(shop, player, "-shop", true);
    CreateUnit(Player(PLAYER_NEUTRAL_PASSIVE), CIRCLE_OF_POWER, padX(seat), benchY(seat), 270.0);
  }
  TriggerAddAction(clicks, trampoline("chess.click"));
  TriggerAddAction(shop, trampoline("chess.shop"));
  globalThis.__chessState = { round: 0, phase: "prep", ticks: 0, seed: 1, seats };
  TimerStart(CreateTimer(), 0.25, true, trampoline("chess.tick"));
  startHotReload();
}
