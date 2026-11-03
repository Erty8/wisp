// The autochess map's entry. Each player gets a board and a shop panel that
// shows its offers with live portraits; the game keeps running while it is
// open. Units move like chess pieces: right-click a square of your half, a
// bench slot or another of your units, and the unit jumps there (swapping
// with the unit already there); right-click the circle of power to sell it.
// When the fight starts computer-played copies fight on their own, with their
// traits' bonuses, against the round's creeps or a copy of another player's
// board; the camera goes to your board and the result stays up for a few
// seconds before your units are back on their squares. Three copies of a
// unit merge into a stronger one. The map's main() calls start() once; every
// hot reload calls the new bundle's install().
import { configureRuntime } from "wisp/src/runtime/config";
import { installDispatch, on, trampoline } from "wisp/src/map/dispatch";
import { installHotReload, startHotReload } from "wisp/src/map/hotReload";
import { f32 } from "wisp/src/sim/f32";
import { floorDiv, floorMod } from "wisp/src/sim/intMath";
import {
  type ActiveTrait, type Bonus, type Square, BENCH_SIZE, LAST_ROUND, MAX_LEVEL, REROLL_COST, SHOP_SIZE, START_GOLD, START_HEALTH, START_LEVEL,
  activeTraits, assignSquares, bonusFor, damageFor, drawFrom, findMerge, income, isCreepRound, kindAt, levelCost, nextSeed,
  raised, rollShop, sellValue, starred, traitLines, waveFor,
} from "./rules";

const SEATS = 2;
const CELL = 192;
const BOARD = 8 * CELL;
const HALF = 4 * CELL;
const QUARTER = 2 * CELL;
/** Each board's center is this far west (player 1) or east (player 2) of the map's center. */
const ARENA_OFFSET = 1664;
const CIRCLE_OF_POWER = 1852010352; // ncop
/** Unused player slots that own the fighting copies: seat N's army is slot 4 + 2N, its foes 5 + 2N. */
const PROXY_BASE = 4;
/** The timer's period is a quarter second. */
const PREP_SECONDS = 30;
const PREP_TICKS = 4 * PREP_SECONDS;
const COMBAT_TICKS = 240;
/** How long a fight's result stays on the board before the next round. */
const AFTERMATH_TICKS = 12;

/** Screen units (the 0.8 by 0.6 frame space) from thousandths. */
const ui = (thousandths: number) => f32(thousandths / 1000);
/** The shop panel's top-left corner, slot size and the portrait model's scale: a portrait model is in world units. */
const PANEL_LEFT = 120, PANEL_TOP = 550, SLOT_WIDTH = 90, SLOT_HEIGHT = 140, MARGIN = 10, SIDE_WIDTH = 100;
const PORTRAIT_SCALE = f32(0.0005);

type Action = { readonly kind: "buy"; readonly slot: number } | { readonly kind: "reroll" | "level" | "hide" };

interface Owned {
  unit: unit;
  readonly kind: number;
  readonly star: number;
}

/** A unit fighting this round and the square it fights from and returns to. */
interface Placed {
  readonly owned: Owned;
  readonly square: Square;
}

interface SlotFrames {
  readonly button: framehandle;
  readonly icon: framehandle;
  readonly portrait: framehandle;
  readonly label: framehandle;
}

interface ShopFrames {
  readonly root: framehandle;
  readonly slots: readonly SlotFrames[];
  readonly info: framehandle;
  readonly reroll: framehandle;
  readonly level: framehandle;
}

interface Seat {
  readonly id: number;
  /** The board's southwest corner. */
  readonly x0: number;
  readonly y0: number;
  gold: number;
  health: number;
  level: number;
  alive: boolean;
  offers: (number | undefined)[];
  pieces: Owned[];
  placed: Placed[];
  army: unit[];
  foes: unit[];
  /** Who the foes are: "the creeps" or the opponent's board. */
  foeName: string;
  resolved: boolean;
  shop: ShopFrames | undefined;
  shopOpen: boolean;
}

interface Move {
  readonly unit: unit;
  readonly x: number;
  readonly y: number;
}

/** Match state lives in a global, so a reloaded bundle continues it. */
interface ChessState {
  round: number;
  phase: "prep" | "combat" | "aftermath" | "over";
  ticks: number;
  /** The match's random sequence (rules.ts nextSeed), the same in every client. */
  seed: number;
  readonly seats: Seat[];
  scoreboard: multiboard | undefined;
  /** Shop buttons by frame handle id. */
  readonly buttons: Map<number, { readonly seat: number; readonly action: Action }>;
  /** Piece orders waiting for the zero-second timer: Warcraft finishes an order event before another order sticks. */
  moves: Move[];
  readonly moveTimer: timer;
  /** Fires on every shop button click. */
  readonly clicks: trigger;
}

declare global {
  var __chessState: ChessState | undefined;
}

function state(): ChessState {
  const current = globalThis.__chessState;
  if (current === undefined) throw new Error("autochess state used before start");
  return current;
}

const say = (seat: Seat, text: string) => DisplayTimedTextToPlayer(Player(seat.id), 0, 0, 10, text);
const sayAll = (text: string) => DisplayTextToForce(GetPlayersAll(), text);
const random = (low: number, high: number) => {
  const chess = state();
  chess.seed = nextSeed(chess.seed);
  return drawFrom(chess.seed, low, high);
};
const dead = (target: unit) => IsUnitType(target, UNIT_TYPE_DEAD);
const isLocal = (seat: Seat) => GetPlayerId(GetLocalPlayer()) === seat.id;
const armyOwner = (seat: Seat) => Player(PROXY_BASE + 2 * seat.id);
const foeOwner = (seat: Seat) => Player(PROXY_BASE + 2 * seat.id + 1);
const nameOf = (seat: Seat) => GetPlayerName(Player(seat.id));
const seatOf = (who: player) => state().seats.find((seat) => seat.id === GetPlayerId(who));

/** The center of board square (`column`, `row`), rows counted from the south edge, 0 to 7. */
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

/** The column under `x` and the row of the own half under `y`, clamped to the board. */
function squareAt(seat: Seat, x: number, y: number): Square {
  let column = 0, row = 0;
  while (column < 7 && x >= seat.x0 + (column + 1) * CELL) column++;
  while (row < 3 && y >= seat.y0 + (row + 1) * CELL) row++;
  return { column, row };
}

/** Moves a unit to a point at once, ignoring pathing, so pieces land exactly on their squares. */
function jump(target: unit, x: number, y: number): void {
  SetUnitX(target, x);
  SetUnitY(target, y);
}

function applyStar(target: unit, star: number): void {
  if (star <= 1) return;
  const life = starred(BlzGetUnitMaxHP(target), star);
  BlzSetUnitMaxHP(target, life);
  SetUnitState(target, UNIT_STATE_LIFE, life);
  BlzSetUnitBaseDamage(target, starred(BlzGetUnitBaseDamage(target, 0), star), 0);
  const scale = star === 2 ? 1.25 : 1.5;
  SetUnitScale(target, scale, scale, scale);
}

function applyBonus(target: unit, bonus: Bonus): void {
  if (bonus.armor > 0) BlzSetUnitArmor(target, BlzGetUnitArmor(target) + bonus.armor);
  if (bonus.lifePercent > 0) {
    const life = raised(BlzGetUnitMaxHP(target), bonus.lifePercent);
    BlzSetUnitMaxHP(target, life);
    SetUnitState(target, UNIT_STATE_LIFE, life);
  }
  if (bonus.damagePercent > 0) BlzSetUnitBaseDamage(target, raised(BlzGetUnitBaseDamage(target, 0), bonus.damagePercent), 0);
  if (bonus.haste > 0) BlzSetUnitAttackCooldown(target, f32(BlzGetUnitAttackCooldown(target, 0) * (bonus.haste === 1 ? 0.75 : 0.625)), 0);
}

function spawnPiece(seat: Seat, kind: number, star: number, x: number, y: number): unit {
  const piece = CreateUnit(Player(seat.id), kindAt(kind).id, x, y, 90.0);
  applyStar(piece, star);
  jump(piece, x, y);
  return piece;
}

/** A computer-played copy that fights for `owner`, with its star and traits. */
function spawnFighter(owner: player, kind: number, star: number, active: readonly ActiveTrait[], x: number, y: number, facing: number): unit {
  const fighter = CreateUnit(owner, kindAt(kind).id, x, y, facing);
  applyStar(fighter, star);
  applyBonus(fighter, bonusFor(kind, active));
  return fighter;
}

function freeBenchSlot(seat: Seat): number | undefined {
  for (let slot = 0; slot < BENCH_SIZE; slot++) {
    const x = squareX(seat, slot);
    if (!seat.pieces.some((owned) => near(owned.unit, x, benchY(seat), 96))) return slot;
  }
  return undefined;
}

function boardTraits(seat: Seat): ActiveTrait[] {
  return activeTraits(seat.pieces.filter((owned) => onOwnHalf(seat, owned.unit)).map((owned) => owned.kind));
}

function sayTraits(seat: Seat, active: readonly ActiveTrait[]): void {
  const lines = traitLines(active);
  say(seat, lines.length === 0 ? "Traits: none yet. Two different units of a race or role unlock a bonus." : `Traits: ${lines.join("  |  ")}`);
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

// The shop panel: every client makes and fills every seat's panel the same
// way, and shows only its own player's.

function createButton(parent: framehandle, context: number, width: number, height: number): framehandle {
  const button = BlzCreateFrameByType("GLUETEXTBUTTON", "AutochessButton", parent, "ScriptDialogButton", context);
  BlzFrameSetSize(button, ui(width), ui(height));
  return button;
}

function createText(parent: framehandle, context: number, width: number, height: number): framehandle {
  const text = BlzCreateFrameByType("TEXT", "AutochessText", parent, "", context);
  BlzFrameSetSize(text, ui(width), ui(height));
  BlzFrameSetTextAlignment(text, TEXT_JUSTIFY_TOP, TEXT_JUSTIFY_CENTER);
  BlzFrameSetEnable(text, false);
  return text;
}

function createShop(seat: Seat): ShopFrames {
  const chess = state();
  const context = seat.id;
  const width = SHOP_SIZE * SLOT_WIDTH + SIDE_WIDTH + 3 * MARGIN;
  const root = BlzCreateFrame("EscMenuBackdrop", BlzGetOriginFrame(ORIGIN_FRAME_GAME_UI, 0), 0, context);
  BlzFrameSetSize(root, ui(width), ui(SLOT_HEIGHT + 2 * MARGIN));
  BlzFrameSetAbsPoint(root, FRAMEPOINT_TOPLEFT, ui(PANEL_LEFT), ui(PANEL_TOP));
  const slots: SlotFrames[] = [];
  for (let slot = 0; slot < SHOP_SIZE; slot++) {
    const button = createButton(root, context, SLOT_WIDTH, SLOT_HEIGHT);
    BlzFrameSetPoint(button, FRAMEPOINT_TOPLEFT, root, FRAMEPOINT_TOPLEFT, ui(MARGIN + slot * SLOT_WIDTH), ui(-MARGIN));
    const icon = BlzCreateFrameByType("BACKDROP", "AutochessIcon", button, "", context);
    BlzFrameSetSize(icon, ui(60), ui(60));
    BlzFrameSetPoint(icon, FRAMEPOINT_TOP, button, FRAMEPOINT_TOP, 0, ui(-12));
    BlzFrameSetEnable(icon, false);
    // The model's origin sits at the frame's bottom-left corner; centered under the icon, its head shows over it.
    const portrait = BlzCreateFrameByType("SPRITE", "AutochessPortrait", button, "", context);
    BlzFrameSetSize(portrait, ui(1), ui(1));
    BlzFrameSetPoint(portrait, FRAMEPOINT_BOTTOMLEFT, icon, FRAMEPOINT_BOTTOM, 0, 0);
    BlzFrameSetScale(portrait, PORTRAIT_SCALE);
    BlzFrameSetEnable(portrait, false);
    const label = createText(button, context, SLOT_WIDTH - 8, 60);
    BlzFrameSetPoint(label, FRAMEPOINT_TOP, icon, FRAMEPOINT_BOTTOM, 0, ui(-4));
    BlzTriggerRegisterFrameEvent(chess.clicks, button, FRAMEEVENT_CONTROL_CLICK);
    chess.buttons.set(GetHandleId(button), { seat: seat.id, action: { kind: "buy", slot } });
    slots.push({ button, icon, portrait, label });
  }
  /** The side column's rows: the info text, then a button every 32 thousandths below a 14 gap; one ui() each, since Lua adds binary32 values in binary32. */
  const side = (index: number) => ui(-MARGIN - index * 32 - (index > 0 ? 14 : 0));
  const info = createText(root, context, SIDE_WIDTH, 40);
  BlzFrameSetPoint(info, FRAMEPOINT_TOPRIGHT, root, FRAMEPOINT_TOPRIGHT, ui(-MARGIN), side(0));
  const reroll = createButton(root, context, SIDE_WIDTH, 30);
  BlzFrameSetPoint(reroll, FRAMEPOINT_TOPRIGHT, root, FRAMEPOINT_TOPRIGHT, ui(-MARGIN), side(1));
  const level = createButton(root, context, SIDE_WIDTH, 30);
  BlzFrameSetPoint(level, FRAMEPOINT_TOPRIGHT, root, FRAMEPOINT_TOPRIGHT, ui(-MARGIN), side(2));
  const hide = createButton(root, context, SIDE_WIDTH, 30);
  BlzFrameSetPoint(hide, FRAMEPOINT_TOPRIGHT, root, FRAMEPOINT_TOPRIGHT, ui(-MARGIN), side(3));
  BlzFrameSetText(hide, "Hide (-shop)");
  for (const button of [reroll, level, hide]) BlzTriggerRegisterFrameEvent(chess.clicks, button, FRAMEEVENT_CONTROL_CLICK);
  chess.buttons.set(GetHandleId(reroll), { seat: seat.id, action: { kind: "reroll" } });
  chess.buttons.set(GetHandleId(level), { seat: seat.id, action: { kind: "level" } });
  chess.buttons.set(GetHandleId(hide), { seat: seat.id, action: { kind: "hide" } });
  return { root, slots, info, reroll, level };
}

function refreshShop(seat: Seat): void {
  const shop = seat.shop;
  if (shop === undefined) return;
  const chess = state();
  BlzFrameSetVisible(shop.root, isLocal(seat) && seat.alive && seat.shopOpen && chess.phase === "prep");
  shop.slots.forEach((frames, slot) => {
    const offer = seat.offers[slot];
    BlzFrameSetVisible(frames.button, offer !== undefined);
    if (offer === undefined) return;
    const kind = kindAt(offer);
    BlzFrameSetTexture(frames.icon, `ReplaceableTextures\\CommandButtons\\${kind.icon}.blp`, 0, true);
    BlzFrameSetModel(frames.portrait, `${kind.model}_portrait.mdl`, 0);
    BlzFrameSetText(frames.label, `${kind.name}\n${kind.cost} gold\n${kind.race}\n${kind.role}`);
  });
  const fighting = seat.pieces.filter((owned) => onOwnHalf(seat, owned.unit)).length;
  BlzFrameSetText(shop.info, `Gold ${seat.gold}\nBoard ${fighting}/${seat.level}`);
  BlzFrameSetText(shop.reroll, `Reroll (${REROLL_COST})`);
  BlzFrameSetText(shop.level, seat.level < MAX_LEVEL ? `Level ${seat.level + 1} (${levelCost(seat.level)})` : "Max level");
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
  say(seat, `Bought ${kind.name} (${seat.gold} gold left).`);
  mergeAll(seat);
}

function click(): void {
  const chess = state();
  const clicked = BlzGetTriggerFrame();
  // Give the keyboard back to the game: a clicked button otherwise keeps its focus.
  BlzFrameSetEnable(clicked, false);
  BlzFrameSetEnable(clicked, true);
  const entry = chess.buttons.get(GetHandleId(clicked));
  const seat = seatOf(GetTriggerPlayer());
  if (entry === undefined || seat === undefined || entry.seat !== seat.id || chess.phase !== "prep" || !seat.alive) return;
  const action = entry.action;
  if (action.kind === "buy") buy(seat, action.slot);
  if (action.kind === "hide") seat.shopOpen = false;
  if (action.kind === "reroll") {
    if (seat.gold < REROLL_COST) say(seat, `A reroll costs ${REROLL_COST} gold.`);
    else {
      seat.gold -= REROLL_COST;
      seat.offers = rollShop(seat.level, random);
    }
  }
  if (action.kind === "level") {
    const cost = levelCost(seat.level);
    if (seat.level >= MAX_LEVEL) say(seat, "You are at the highest level.");
    else if (seat.gold < cost) say(seat, `Level ${seat.level + 1} costs ${cost} gold.`);
    else {
      seat.gold -= cost;
      seat.level++;
      say(seat, `Level ${seat.level}: up to ${seat.level} units fight.`);
    }
  }
  refreshShop(seat);
}

function shopCommand(): void {
  const seat = seatOf(GetTriggerPlayer());
  if (seat === undefined || !seat.alive) return;
  seat.shopOpen = !seat.shopOpen;
  if (state().phase !== "prep") say(seat, "The shop opens after the fight.");
  refreshShop(seat);
}

function traitsCommand(): void {
  const seat = seatOf(GetTriggerPlayer());
  if (seat !== undefined && seat.alive) sayTraits(seat, boardTraits(seat));
}

// Chess moves: an order to a point or a unit becomes a jump in the next instant.

function order(): void {
  const chess = state();
  const target = GetOrderTargetUnit();
  const x = target === undefined ? GetOrderPointX() : GetUnitX(target);
  const y = target === undefined ? GetOrderPointY() : GetUnitY(target);
  chess.moves.push({ unit: GetTriggerUnit(), x, y });
  TimerStart(chess.moveTimer, 0, false, trampoline("chess.place"));
}

function place(): void {
  const chess = state();
  const moves = chess.moves;
  chess.moves = [];
  for (const move of moves) {
    const seat = seatOf(GetOwningPlayer(move.unit));
    const owned = seat?.pieces.find((piece) => piece.unit === move.unit);
    if (seat === undefined || owned === undefined) continue;
    movePiece(seat, owned, move.x, move.y);
  }
}

function movePiece(seat: Seat, owned: Owned, x: number, y: number): void {
  const fromX = GetUnitX(owned.unit), fromY = GetUnitY(owned.unit);
  IssueImmediateOrder(owned.unit, "stop");
  if (state().phase === "prep" && Math.abs(x - padX(seat)) <= 128 && Math.abs(y - benchY(seat)) <= 128) {
    const value = sellValue(kindAt(owned.kind).cost, owned.star);
    seat.gold += value;
    RemoveUnit(owned.unit);
    seat.pieces = seat.pieces.filter((candidate) => candidate !== owned);
    say(seat, `Sold ${kindAt(owned.kind).name} for ${value} gold.`);
    return refreshShop(seat);
  }
  const onBoard = x >= seat.x0 && x <= seat.x0 + BOARD && y >= seat.y0 && y <= seat.y0 + HALF;
  const onBench = x >= seat.x0 && x <= seat.x0 + BOARD && Math.abs(y - benchY(seat)) <= 96;
  // During a fight the board's units are away; pieces only move between bench slots.
  if (!(onBench || (onBoard && state().phase === "prep"))) return jump(owned.unit, fromX, fromY);
  const square = squareAt(seat, x, y);
  const toX = squareX(seat, square.column), toY = onBoard ? squareY(seat, square.row) : benchY(seat);
  const occupant = seat.pieces.find((piece) => piece !== owned && near(piece.unit, toX, toY, 64));
  if (occupant !== undefined) jump(occupant.unit, fromX, fromY);
  jump(owned.unit, toX, toY);
  refreshShop(seat);
}

function startPrep(): void {
  const chess = state();
  chess.round++;
  chess.phase = "prep";
  chess.ticks = 0;
  const against = isCreepRound(chess.round) || chess.seats.filter((seat) => seat.alive).length < 2 ? "creeps" : "the other player's board";
  for (const seat of chess.seats) {
    if (!seat.alive) continue;
    seat.gold += chess.round === 1 ? START_GOLD : income(seat.gold);
    seat.offers = rollShop(seat.level, random);
    seat.shopOpen = true;
    say(seat, `Round ${chess.round} against ${against}: ${PREP_SECONDS} seconds to buy and place units. Up to ${seat.level} units on the south half of your board fight.`);
    refreshShop(seat);
  }
}

/** Snaps the seat's fighting units to squares and takes them off the board while their copies fight. */
function placeUnits(seat: Seat): void {
  const onBoard = seat.pieces.filter((owned) => onOwnHalf(seat, owned.unit));
  for (const extra of onBoard.slice(seat.level)) {
    const bench = freeBenchSlot(seat);
    if (bench !== undefined) jump(extra.unit, squareX(seat, bench), benchY(seat));
  }
  if (onBoard.length > seat.level) say(seat, `Only ${seat.level} units fit at level ${seat.level}; the rest went back to the bench.`);
  const fighting = onBoard.slice(0, seat.level);
  const squares = assignSquares(fighting.map((owned) => squareAt(seat, GetUnitX(owned.unit), GetUnitY(owned.unit))));
  seat.placed = [];
  fighting.forEach((owned, index) => {
    const square = squares[index];
    if (square !== undefined) seat.placed.push({ owned, square });
  });
  for (const { owned } of seat.placed) RemoveUnit(owned.unit);
}

function startCombat(): void {
  const chess = state();
  chess.phase = "combat";
  chess.ticks = 0;
  const alive = chess.seats.filter((seat) => seat.alive);
  for (const seat of alive) {
    refreshShop(seat);
    placeUnits(seat);
  }
  const creeps = isCreepRound(chess.round) || alive.length < 2;
  alive.forEach((seat, index) => {
    const active = activeTraits(seat.placed.map(({ owned }) => owned.kind));
    seat.army = seat.placed.map(({ owned, square }) =>
      spawnFighter(armyOwner(seat), owned.kind, owned.star, active, squareX(seat, square.column), squareY(seat, square.row), 90.0));
    const opponent = alive[floorMod(index + 1, alive.length)];
    if (creeps || opponent === undefined) {
      seat.foeName = "the creeps";
      seat.foes = waveFor(chess.round).map((creep) =>
        spawnFighter(foeOwner(seat), creep.kind, creep.star, [], squareX(seat, creep.column), squareY(seat, 4 + creep.row), 270.0));
    } else {
      // The opponent's board, turned to face this one: their front row meets ours in the middle.
      const theirs = activeTraits(opponent.placed.map(({ owned }) => owned.kind));
      seat.foeName = `${nameOf(opponent)}'s board`;
      seat.foes = opponent.placed.map(({ owned, square }) =>
        spawnFighter(foeOwner(seat), owned.kind, owned.star, theirs, squareX(seat, 7 - square.column), squareY(seat, 7 - square.row), 270.0));
    }
    for (const fighter of seat.army) IssuePointOrder(fighter, "attack", seat.x0 + HALF, seat.y0 + 3 * QUARTER);
    for (const foe of seat.foes) IssuePointOrder(foe, "attack", seat.x0 + HALF, seat.y0 + QUARTER);
    seat.resolved = false;
    if (isLocal(seat)) PanCameraToTimed(seat.x0 + HALF, seat.y0 + HALF, 0.5);
    sayTraits(seat, active);
    say(seat, `Fight! Your ${seat.army.length} units against ${seat.foes.length} of ${seat.foeName}.`);
  });
}

/** Scores a finished fight; its units stay on the board until the aftermath ends. */
function resolve(seat: Seat): void {
  const chess = state();
  const survivors = seat.foes.filter((foe) => !dead(foe)).length;
  const lost = damageFor(survivors, chess.round);
  seat.health -= lost;
  seat.resolved = true;
  if (lost === 0) say(seat, `Round ${chess.round} won!`);
  else say(seat, `${survivors} of ${seat.foeName} survived: you lose ${lost} health (${Math.max(seat.health, 0)} left).`);
  if (seat.health > 0) return;
  seat.alive = false;
  for (const owned of seat.pieces) RemoveUnit(owned.unit);
  seat.pieces = [];
  seat.placed = [];
  sayAll(`${nameOf(seat)} is out after round ${chess.round}.`);
}

/** Clears the fights and puts each player's units back on their squares. */
function clearFights(): void {
  for (const seat of state().seats) {
    for (const fighter of [...seat.army, ...seat.foes]) RemoveUnit(fighter);
    seat.army = [];
    seat.foes = [];
    for (const { owned, square } of seat.placed) owned.unit = spawnPiece(seat, owned.kind, owned.star, squareX(seat, square.column), squareY(seat, square.row));
    seat.placed = [];
  }
}

function showScoreboard(): void {
  const chess = state();
  const board = chess.scoreboard;
  if (board === undefined) return;
  const left = Math.max(0, PREP_SECONDS - floorDiv(chess.ticks, 4));
  const title = chess.phase === "over" ? "Game over" : chess.phase === "prep" ? `Round ${chess.round}: fight in ${left} s` : `Round ${chess.round}: fighting`;
  MultiboardSetTitleText(board, title);
  const cell = (row: number, column: number, text: string, width: number) => {
    const item = MultiboardGetItem(board, row, column);
    MultiboardSetItemStyle(item, true, false);
    MultiboardSetItemValue(item, text);
    MultiboardSetItemWidth(item, width);
    MultiboardReleaseItem(item);
  };
  ["Player", "Health", "Gold", "Level"].forEach((text, column) => cell(0, column, text, column === 0 ? 0.125 : 0.0625));
  chess.seats.forEach((seat, index) => {
    cell(index + 1, 0, nameOf(seat), 0.125);
    cell(index + 1, 1, seat.alive ? `${seat.health}` : "out", 0.0625);
    cell(index + 1, 2, `${seat.gold}`, 0.0625);
    cell(index + 1, 3, `${seat.level}`, 0.0625);
  });
}

/** The first tick, once loading is over: Warcraft doesn't draw a scoreboard made during map initialization. */
function begin(): void {
  const chess = state();
  FogEnable(false);
  FogMaskEnable(false);
  for (const seat of chess.seats) {
    if (isLocal(seat)) PanCameraToTimed(seat.x0 + HALF, seat.y0 + QUARTER, 0);
    seat.shop = createShop(seat);
  }
  const board = CreateMultiboard();
  MultiboardSetColumnCount(board, 4);
  MultiboardSetRowCount(board, 1 + chess.seats.length);
  chess.scoreboard = board;
  sayAll("Autochess: buy units in the shop. Right-click a square to move a unit there like a chess piece, or the circle of power to sell it. Units on the south half of your board fight on their own; two different units of a race or role unlock a trait bonus (-traits).");
  startPrep();
  showScoreboard();
  MultiboardDisplay(board, true);
}

function tick(): void {
  const chess = state();
  if (chess.phase === "over") return;
  if (chess.round === 0) return begin();
  for (const seat of chess.seats) SetPlayerState(Player(seat.id), PLAYER_STATE_RESOURCE_GOLD, Math.max(seat.gold, 0));
  chess.ticks++;
  if (floorMod(chess.ticks, 4) === 0) showScoreboard();
  if (chess.phase === "prep") {
    if (chess.ticks === PREP_TICKS - 40) sayAll("The fight starts in 10 seconds.");
    if (chess.ticks >= PREP_TICKS) startCombat();
    return;
  }
  if (chess.phase === "aftermath") {
    if (chess.ticks < AFTERMATH_TICKS) return;
    clearFights();
    const standing = chess.seats.filter((seat) => seat.alive);
    if (standing.length === 0 || chess.round >= LAST_ROUND) {
      chess.phase = "over";
      showScoreboard();
      sayAll(standing.length === 0 ? "Game over: nobody is left standing." : `Victory! ${standing.map((seat) => nameOf(seat)).join(" and ")} survived all ${LAST_ROUND} rounds.`);
      return;
    }
    return startPrep();
  }
  for (const seat of chess.seats) {
    if (!seat.alive || seat.resolved) continue;
    const foesLeft = seat.foes.some((foe) => !dead(foe));
    const armyLeft = seat.army.some((fighter) => !dead(fighter));
    if (!foesLeft || !armyLeft || chess.ticks >= COMBAT_TICKS) resolve(seat);
  }
  if (chess.seats.some((seat) => seat.alive && !seat.resolved)) return;
  chess.phase = "aftermath";
  chess.ticks = 0;
}

export function install(this: void): void {
  configureRuntime({ filePrefix: "autochess", readyPrefix: "AC_HRR", globalPrefix: "__chess" });
  installDispatch();
  on("chess.tick", tick);
  on("chess.click", click);
  on("chess.shop", shopCommand);
  on("chess.traits", traitsCommand);
  on("chess.order", order);
  on("chess.place", place);
  installHotReload();
}

/** Each seat's copies fight only their own foes, and none of them touch the players' own units. */
function setAlliances(seats: readonly Seat[]): void {
  const proxies = seats.flatMap((seat) => [armyOwner(seat), foeOwner(seat)]);
  for (const seat of seats) {
    SetPlayerColor(armyOwner(seat), GetPlayerColor(Player(seat.id)));
    for (const proxy of proxies) {
      SetPlayerAlliance(Player(seat.id), proxy, ALLIANCE_PASSIVE, true);
      SetPlayerAlliance(proxy, Player(seat.id), ALLIANCE_PASSIVE, true);
    }
    for (const other of seats) {
      if (other === seat) continue;
      for (const mine of [armyOwner(seat), foeOwner(seat)]) {
        for (const theirs of [armyOwner(other), foeOwner(other)]) SetPlayerAlliance(mine, theirs, ALLIANCE_PASSIVE, true);
      }
    }
  }
}

export function start(this: void): void {
  install();
  const centerX = GetRectCenterX(bj_mapInitialPlayableArea);
  const centerY = GetRectCenterY(bj_mapInitialPlayableArea);
  const seats: Seat[] = [];
  const clicks = CreateTrigger();
  const shop = CreateTrigger();
  const traits = CreateTrigger();
  const orders = CreateTrigger();
  const everyUnit = Filter(() => true);
  for (let id = 0; id < SEATS; id++) {
    const player = Player(id);
    if (GetPlayerSlotState(player) !== PLAYER_SLOT_STATE_PLAYING || GetPlayerController(player) !== MAP_CONTROL_USER) continue;
    seats.push({
      id, x0: centerX + (id === 0 ? -ARENA_OFFSET : ARENA_OFFSET) - HALF, y0: centerY - HALF,
      gold: 0, health: START_HEALTH, level: START_LEVEL, alive: true,
      offers: [], pieces: [], placed: [], army: [], foes: [], foeName: "the creeps", resolved: true, shop: undefined, shopOpen: true,
    });
    TriggerRegisterPlayerChatEvent(shop, player, "-shop", true);
    TriggerRegisterPlayerChatEvent(traits, player, "-traits", true);
    TriggerRegisterPlayerUnitEvent(orders, player, EVENT_PLAYER_UNIT_ISSUED_POINT_ORDER, everyUnit);
    TriggerRegisterPlayerUnitEvent(orders, player, EVENT_PLAYER_UNIT_ISSUED_TARGET_ORDER, everyUnit);
  }
  for (const seat of seats) CreateUnit(Player(PLAYER_NEUTRAL_PASSIVE), CIRCLE_OF_POWER, padX(seat), benchY(seat), 270.0);
  setAlliances(seats);
  TriggerAddAction(clicks, trampoline("chess.click"));
  TriggerAddAction(shop, trampoline("chess.shop"));
  TriggerAddAction(traits, trampoline("chess.traits"));
  TriggerAddAction(orders, trampoline("chess.order"));
  globalThis.__chessState = {
    round: 0, phase: "prep", ticks: 0, seed: 1, seats, scoreboard: undefined, buttons: new Map(), moves: [], moveTimer: CreateTimer(), clicks,
  };
  TimerStart(CreateTimer(), 0.25, true, trampoline("chess.tick"));
  startHotReload();
}
