// The role-playing strategy (RPS) map's entry, a 1999-style prototype: each
// player has one hero and a small retinue, a damped third-person camera that
// swings in behind the hero as he runs, WASD movement relative to the camera,
// Tab soft-targeting, manual attacks and a guard (./combat.ts), a spell bar,
// squad stances and capturable income outposts. Each player first picks a
// race and a hero (./picker.ts, ./roster.ts); the hero spawns alone on the
// player's start location and recruits his race's soldiers from the
// quartermaster beside it, in a dialogue. E beside an NPC plays a personal
// dialogue scene (./dialogue.ts, ./letterbox.ts) for that player alone. Nothing is ever selected and Warcraft's interface is all below
// the screen; the map draws its own (./hud.ts), so no Warcraft hotkey fires.
// The default melee initialization never runs (wisp:docs/sample-map.md, "The
// base map"), so there are no starting workers or town halls.
//
// Everything that orders units or changes ownership is synchronized: key
// events reach every client, and positions come from integer math in
// ./rules.ts. Only the camera, the hidden trees and the target's ring and tint
// are applied for the local player. The map's main() calls start() once;
// every hot reload calls the new bundle's install().
import { configureRuntime } from "wisp/src/runtime/config";
import { installDispatch, on, trampoline } from "wisp/src/map/dispatch";
import { installHotReload, startHotReload } from "wisp/src/map/hotReload";
import { f32 } from "wisp/src/sim/f32";
import { floorDiv, floorMod } from "wisp/src/sim/intMath";
import { type Box, MINIMAP, OFF_SCREEN_BOX } from "./layout";
import { type Hud, type ItemView, type SlotView, createHud, hudAction, showHud } from "./hud";
import { type Reachable, interactHint, interaction } from "./interact";
import { activeQuests, journalText, questLog } from "./journal";
import { syncQuestLog } from "./questLog";
import { type Picker, createPicker, pickerAction, showPicker } from "./picker";
import { choiceOf, createLetterbox } from "./letterbox";
import { RECRUIT_SCENE, STARTING_GOLD, TAVERN_SCENE, WANDERERS, recruitOutcome } from "./dialogue";
import { QUEST_SITES } from "./quests";
import { type Npc, type SceneSeat, type SceneState, flagsOf, goldOf, installScenes } from "./sceneHost";
import { chooseLine, endScene, fadeTick, playNearest, sceneTick, skipLine, startScene, talkCheck, talkTarget, voiceSynced } from "./scenes";
import { questTick } from "./questRuntime";
import { KILL_CAM_RANGE, KILL_CAM_TICKS, SLOW_MOTION_RADIUS, SLOW_MOTION_SCALE, endsFight, killCamShot } from "./killcam";
import { type Hero, type Race, type Skill, DEFAULT_PICK, HERO_LISTS, PICK_SECONDS, disabledIcon, heroList, heroListNames, heroOf, icon, raceOf, rawcode } from "./roster";
import {
  AUTO_TARGET_RANGE, BLOCK_MANA, CLICK_SETTLE_TICKS, FINISHER_KNOCKBACK, GUARD_POSE_TICKS, GUARD_SPEED_DENOMINATOR, GUARD_SPEED_NUMERATOR, HIT_STOP_TICKS, IMPACT_TICKS,
  PARRY_COUNTER_DAMAGE, PARRY_KNOCKBACK, RECOIL_TICKS, STAGGER_TICKS, SWING_HALF_ANGLE, SWING_RANGE, bufferable, canAct, stepIn, swingTicks,
  atan2Tenths, attackFacing, autoTarget, ringCorner, ringSize, blockedDamage, guardOutcome, inCone, isSpellBarClick, nextComboStep, swingDamage,
} from "./combat";
import {
  type Candidate, type Point, type Role, type SkillRanks, type Stance, type Yaw,
  CAMERA_PERIOD_MS, CAPTURE_RADIUS, DEFAULT_CAMERA, SHAKE_MS, SHAKE_RANGE, FAR_Z, FOOD_CAP, OCCLUSION_RADIUS, START_YAW, TARGET_RANGE, CAMERA_PRESETS, type CameraPreset, describeCamera,
  cameraZOffset, captureOwner, combatAfter, distanceSquared, eyePoint, fourCC, isHomeMine, outpostBeside, guardSlot, income, movePoint, needsRegroup, nextTarget,
  canLearn, dragYaw, nextSkill, occludes, offset, percentOf, rankText, vanguardSlot,
} from "./rules";
import {
  SEATS, CAMERA_PERIOD, OCCLUSION_PERIOD, STANCE_PERIOD, PICKUP_RANGE, INVENTORY_SLOTS, ARRANGE_DELAY, HUD_PERIOD, CAPTURE_PERIOD, INCOME_PERIOD, MOVE_EVERY_TICKS, DEAD_LIFE, SKILL_KEYS, SHAKE_MAGNITUDE, SHAKE_VELOCITY, SWING_SPEED, COUNTER_SPEED, SLASH_MODEL, PARRY_MODEL, BLOCK_MODEL, GUARD_MODEL, GUARD_WALK_SPEED, RECOIL_SPEED, FLOAT_TEXT_SIZE, FLOAT_TEXT_RISE, ATTACK_ABILITY, OUTPOST, ORDER_MOVE, ORDER_SMART, YAW_PREFIX, TAVERN, GOLD_MINE, CREEPS, ui, RING_TEXTURE, IMAGE_TYPE_SELECTION, TARGET_TINT, VOICE_PREFIX, KEY, KEY_CODES, SKILL_KEY_CODES, PICK_KEYS, CAMERA_KEYS,
} from "./constants";


interface Member {
  readonly unit: unit;
  readonly role: Role;
}

/** A swing in progress: its aim (tenths of a degree), combo step and the ticks it lands and ends on. */
interface Swing {
  readonly facing: number;
  readonly step: number;
  readonly impact: number;
  readonly recover: number;
  landed: boolean;
}

/** The hero's manual combat state, all in camera ticks (0.03 s). */
interface Fight {
  swing: Swing | undefined;
  /** The last swing's combo step and the tick it recovered on. */
  step: number;
  recoverTick: number;
  /** The tick the guard went up, while it is up. */
  guardTick: number | undefined;
  /** The tick the guard freezes in its pose, if it is waiting to. */
  poseTick: number | undefined;
  /** Units frozen by hit-stop and the tick they move again. */
  frozen: unit[];
  thawTick: number;
  /** The hero's own move speed, which a raised guard slows. */
  readonly speed: number;
  /** A left click waiting CLICK_SETTLE_TICKS to swing, in case it was on the spell bar. */
  pending: { readonly click: Point | undefined; readonly tick: number } | undefined;
  /** The tick of the player's last spell bar click. */
  barTick: number;
  /** A swing pressed while one is recovering: it starts the moment that one ends. */
  buffered: { readonly click: Point | undefined } | undefined;
  /** How many ticks into a swing the damage lands: IMPACT_TICKS, or what -impact set for this model. */
  impactTicks: number;
  /** The guard's pose: "stand ready", or an animation index frozen some ticks in, as -guard set. */
  guardPose: { readonly index: number; readonly freeze: number } | undefined;
  /** The shield bubble while the guard is up. */
  guardEffect: effect | undefined;
  /** The tick a broken guard's stagger ends. */
  staggerUntil: number;
}

interface Keys {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
}

interface Seat extends SceneSeat {
  /** The race and hero the player picked. */
  readonly race: Race;
  readonly heroInfo: Hero;
  readonly squad: Member[];
  readonly keys: Keys;
  readonly fight: Fight;
  yaw: Yaw;
  /** Milliseconds the squad stays in combat after its last hit. */
  combatMs: number;
  stance: Stance;
  target: unit | undefined;
  /** The ring under the target and its size, shown to this player alone. */
  ring?: { readonly image: image; readonly size: number } | undefined;
  /** Trees this seat's camera has hidden. */
  hidden: destructable[];
  /** Milliseconds of camera shake left. */
  shakeMs: number;
  /** The CAMERA_PRESETS index this player's camera uses. */
  camera: number;
  /** The map's interface for this player: health and mana, spell bar. */
  hud: Hud | undefined;
  /** Whether the player has his inventory open (its button, or I). */
  inventoryOpen?: boolean | undefined;
  /** Whether the hero is rooted (`rootTick`). */
  rooted?: boolean | undefined;
  /** The kill cam on the last enemy of a fight: where it fell and the tick the shot began, while it plays. */
  killCam?: { readonly fallen: Point; readonly start: number } | undefined;
}

/** Match state lives in a global, so a reloaded bundle continues it; the scene engine keeps its own in it (`SceneState`). */
interface RpsState extends SceneState {
  ticks: number;
  readonly seats: Seat[];
  readonly outposts: unit[];
  /** One rect reused by every query, so nothing leaks (the group and location are the scene engine's, shared). */
  readonly rect: rect;
  /** Fires on every spell bar click. */
  readonly clicks: trigger;
  /** Animation indices -combo set for the three swings, in place of the attack animations by name. */
  comboAnimations?: readonly number[] | undefined;
  /** Every player's race and hero pick, until they have picked. */
  readonly picks: Pick[];
  /**
   * This client's own right-mouse drag: the pointer's last X, the yaw dragged
   * to and the last yaw sent. Local to each client, it only ever turns the
   * local camera and is sent to the others by sync.
   */
  readonly drag: { lastX: number | undefined; yaw: number | undefined; sent: number | undefined };
  /** Parts of the map `-off` has switched off. */
  off?: Set<string> | undefined;
  /** While a parry's counter-slash deals its damage, so it isn't parried in turn. */
  countering?: boolean | undefined;
  /** While a swing or a counter-slash deals its damage, so it doesn't shake the camera. */
  meleeHit?: boolean | undefined;
  /** Units in a kill cam's slow motion, each with the speed it would play at without it, and the tick it ends. */
  slowed?: Map<unit, number> | undefined;
  slowUntil?: number | undefined;
}

/** A player choosing: the race chosen so far, if any, and their picker. */
interface Pick {
  readonly id: number;
  readonly player: player;
  /** The race the player chose in Warcraft's lobby (`gameRace`), as an index into RACES. */
  readonly race: number;
  /** The hero list he is looking at (`heroList`: his race's, or a page of the tavern's), once he has chosen one. */
  list: number | undefined;
  done: boolean;
  readonly menu: Picker;
}

declare global {
  var __rpsState: RpsState | undefined;
}

function state(): RpsState {
  const current = globalThis.__rpsState;
  if (current === undefined) throw new Error("rps state used before start");
  return current;
}

const say = (seat: Seat, text: string) => DisplayTimedTextToPlayer(seat.player, 0, 0, 6, text);
const sayAll = (text: string) => DisplayTextToForce(GetPlayersAll(), text);
const isLocal = (seat: Seat) => GetPlayerId(GetLocalPlayer()) === seat.id;
const alive = (target: unit) => GetWidgetLife(target) > DEAD_LIFE;
/** A unit's position in whole units, so the integer rules see the same point in every client. */
const pointOf = (target: unit): Point => ({ x: Math.floor(GetUnitX(target)), y: Math.floor(GetUnitY(target)) });

/** The units in `radius` of (x, y), through the shared group. */
function unitsInRange(x: number, y: number, radius: number): unit[] {
  const rps = state();
  GroupEnumUnitsInRange(rps.group, x, y, radius, rps.everything);
  const found: unit[] = [];
  const size = BlzGroupGetSize(rps.group);
  for (let index = 0; index < size; index++) found.push(BlzGroupUnitAt(rps.group, index));
  return found;
}

/** The map's own seat for a player the scene engine names. */
function seatFor(scene: SceneSeat): Seat {
  const seat = state().seats.find((candidate) => candidate.id === scene.id);
  if (seat === undefined) throw new Error(`no seat ${scene.id}`);
  return seat;
}

function seatOf(target: player): Seat | undefined {
  const id = GetPlayerId(target);
  return state().seats.find((seat) => seat.id === id);
}

// Camera: 0.03 s.

/** Whether the player holds a movement key. */
function moving(seat: Seat): boolean {
  const { keys } = seat;
  return keys.w || keys.a || keys.s || keys.d;
}

function issueMove(seat: Seat): void {
  const { keys } = seat;
  const point = movePoint(pointOf(seat.hero), seat.yaw.current, { forward: keys.w, left: keys.a, back: keys.s, right: keys.d });
  // A move order would cut a swing short, so WASD waits for it to end.
  if (point !== undefined && alive(seat.hero) && seat.fight.swing === undefined && canAct(now(), seat.fight.staggerUntil)) IssuePointOrder(seat.hero, "move", point.x, point.y);
}

/** The player's chosen camera preset. */
function cameraOf(seat: Seat): CameraPreset {
  return CAMERA_PRESETS[seat.camera] ?? CAMERA_PRESETS[0] ?? { name: "Exploration", distance: 950, attack: -240, fieldOfView: 80, zOffset: 120 };
}

/**
 * The local player's right-mouse drag: while the button is held, the pointer's
 * sideways movement turns this client's camera at once (`dragYaw`, a full
 * screen a full turn), and every 3 ticks the new yaw is sent to every client
 * (`BlzSendSyncData`), where it becomes the yaw WASD goes by. Only
 * the drag sends anything; the pointer itself is read on this client alone.
 */
function dragTick(seat: Seat): void {
  const rps = state();
  const { drag } = rps;
  if (!BlzIsMouseButtonPressed(MOUSE_BUTTON_TYPE_RIGHT)) {
    drag.lastX = undefined;
    if (drag.yaw !== undefined && drag.sent !== drag.yaw) {
      BlzSendSyncData(YAW_PREFIX, `${drag.yaw}`);
      drag.sent = drag.yaw;
    }
    if (drag.yaw !== undefined && seat.yaw.current === drag.yaw) drag.yaw = undefined;
    return;
  }
  // The pointer reads in screen frame units (0 to 0.8) or pixels, depending on the game build.
  const raw = BlzGetMouseScreenPosX();
  const inFrameUnits = raw <= 1;
  const x = inFrameUnits ? Math.floor(raw * 1000) : Math.floor(raw);
  const width = inFrameUnits ? 800 : BlzGetLocalClientWidth();
  if (drag.lastX !== undefined && x !== drag.lastX) drag.yaw = dragYaw(drag.yaw ?? seat.yaw.current, x - drag.lastX, width);
  drag.lastX = x;
  if (drag.yaw !== undefined && drag.sent !== drag.yaw && floorMod(rps.ticks, 3) === 0) {
    BlzSendSyncData(YAW_PREFIX, `${drag.yaw}`);
    drag.sent = drag.yaw;
  }
}

/** A player's dragged yaw reaches every client: it is what WASD and the tree check turn by. */
function yawSynced(): void {
  const seat = seatOf(GetTriggerPlayer());
  if (seat === undefined) return;
  const yaw = S2I(BlzGetTriggerSyncData());
  seat.yaw = { current: yaw, target: yaw };
}

/**
 * Roots the hero while the player isn't walking him: with no movement key held,
 * mid-swing, staggered or in a scene, his propulsion window is 0, so Warcraft
 * can't move him at all, whatever order it gives (a flight from a hit, the
 * rest of a WASD step). Turning, knockbacks, step-ins and a scene's places
 * (`SetUnitPosition`) still work. A movement key gives him his own window back
 * on the same tick, before the move order goes out.
 */
function rootTick(seat: Seat): void {
  const rooted = !off("root") && (seat.scene !== undefined || !moving(seat) || seat.fight.swing !== undefined || !canAct(now(), seat.fight.staggerUntil));
  if (rooted === seat.rooted) return;
  seat.rooted = rooted;
  SetUnitPropWindow(seat.hero, rooted ? 0 : GetUnitDefaultPropWindow(seat.hero));
}

/**
 * Keeps the hero where the player leaves him. A unit that can't attack runs
 * from whatever hits it, and the hero has no attack ability, so while no
 * movement key is held and he isn't swinging, a move he didn't order (a flight,
 * or the rest of the last WASD step) gives way to hold position.
 */
function holdGround(seat: Seat): void {
  const { hero } = seat;
  if (seat.scene !== undefined || moving(seat) || !alive(hero)) return;
  const order = GetUnitCurrentOrder(hero);
  if (order === ORDER_MOVE || order === ORDER_SMART) IssueImmediateOrder(hero, "holdposition");
}

/**
 * Sets a unit's animation speed. Every speed change goes through here, so a
 * unit in a kill cam's slow motion keeps playing at a quarter of whatever the
 * fight sets, and gets that speed back when the slow motion ends.
 */
function timeScale(target: unit, speed: number): void {
  const slowed = state().slowed;
  if (slowed !== undefined && slowed.has(target)) {
    slowed.set(target, speed);
    SetUnitTimeScale(target, speed * SLOW_MOTION_SCALE);
  } else SetUnitTimeScale(target, speed);
}

/**
 * A unit died. For each hero whose fight it ends (it fell within
 * KILL_CAM_RANGE of him, in combat, with no other enemy standing that near),
 * his player's camera glides onto it, and every unit within
 * SLOW_MOTION_RADIUS of it, the fallen included, plays in slow motion for the
 * length of the shot. Every client runs this alike; only the camera is local.
 */
function died(): void {
  const rps = state();
  const dying = GetTriggerUnit();
  const fallen = pointOf(dying);
  let slowMotion = false;
  for (const seat of rps.seats) {
    if (seat.scene !== undefined || seat.killCam !== undefined || seat.combatMs <= 0 || !alive(seat.hero) || !IsUnitEnemy(dying, seat.player)) continue;
    const hero = pointOf(seat.hero);
    const others = unitsInRange(hero.x, hero.y, KILL_CAM_RANGE)
      .filter((other) => other !== dying && alive(other) && IsUnitEnemy(other, seat.player) && !IsUnitType(other, UNIT_TYPE_STRUCTURE))
      .map((other) => pointOf(other));
    if (!endsFight(hero, fallen, others)) continue;
    if (!off("killcam")) seat.killCam = { fallen, start: now() };
    slowMotion = true;
  }
  if (!slowMotion || off("slowmo")) return;
  const slowed = rps.slowed ?? new Map<unit, number>();
  rps.slowed = slowed;
  rps.slowUntil = now() + KILL_CAM_TICKS;
  for (const target of [dying, ...unitsInRange(fallen.x, fallen.y, SLOW_MOTION_RADIUS)]) {
    if (slowed.has(target)) continue;
    slowed.set(target, 1);
    SetUnitTimeScale(target, SLOW_MOTION_SCALE);
  }
}

/** The slow motion ends with the last kill cam that called for it: every slowed unit gets its own speed back. */
function slowMotionTick(): void {
  const rps = state();
  if (rps.slowed === undefined || now() < (rps.slowUntil ?? 0)) return;
  const slowed = rps.slowed;
  rps.slowed = undefined;
  slowed.forEach((speed, target) => {
    SetUnitTimeScale(target, speed);
  });
}

/**
 * The local player's kill cam: the shot of `killCamShot` for this tick, over
 * the hero's camera as the player left it, lifted by however far the fallen
 * enemy lies above the hero as it glides onto him.
 */
function applyKillCam(seat: Seat, run: { readonly fallen: Point; readonly start: number }, heroX: number, heroY: number): void {
  const rps = state();
  const duration = CAMERA_PERIOD;
  const hero = { x: Math.floor(heroX), y: Math.floor(heroY) };
  const shot = killCamShot(cameraOf(seat), rps.drag.yaw ?? seat.yaw.current, hero, run.fallen, now() - run.start);
  SetCameraTargetController(seat.hero, shot.focus.x, shot.focus.y, false);
  SetCameraField(CAMERA_FIELD_ROTATION, shot.yaw / 10, duration);
  SetCameraField(CAMERA_FIELD_TARGET_DISTANCE, shot.distance, duration);
  SetCameraField(CAMERA_FIELD_ANGLE_OF_ATTACK, shot.attack / 10, duration);
  SetCameraField(CAMERA_FIELD_FIELD_OF_VIEW, shot.fieldOfView, duration);
  MoveLocation(rps.location, heroX, heroY);
  const heroZ = GetLocationZ(rps.location);
  MoveLocation(rps.location, hero.x + shot.focus.x, hero.y + shot.focus.y);
  const focusZ = GetLocationZ(rps.location);
  SetCameraField(CAMERA_FIELD_ZOFFSET, shot.zOffset + focusZ - heroZ, duration);
}

/** The local player's camera: locked to the hero, turned by the eased follow yaw, lifted over hills behind the hero. */
function applyCamera(seat: Seat, heroX: number, heroY: number): void {
  const rps = state();
  const duration = CAMERA_PERIOD;
  const preset = cameraOf(seat);
  SetCameraField(CAMERA_FIELD_ROTATION, (rps.drag.yaw ?? seat.yaw.current) / 10, duration);
  SetCameraField(CAMERA_FIELD_TARGET_DISTANCE, preset.distance, duration);
  SetCameraField(CAMERA_FIELD_ANGLE_OF_ATTACK, preset.attack / 10, duration);
  SetCameraField(CAMERA_FIELD_FIELD_OF_VIEW, preset.fieldOfView, duration);
  SetCameraField(CAMERA_FIELD_FARZ, FAR_Z, duration);
  MoveLocation(rps.location, heroX, heroY);
  const heroZ = GetLocationZ(rps.location);
  MoveLocation(rps.location, GetCameraEyePositionX(), GetCameraEyePositionY());
  const eyeZ = GetLocationZ(rps.location);
  SetCameraField(CAMERA_FIELD_ZOFFSET, cameraZOffset(heroZ, eyeZ, preset.zOffset), duration);
}

function cameraTick(): void {
  const rps = state();
  rps.ticks++;
  const moveNow = floorMod(rps.ticks, MOVE_EVERY_TICKS) === 0;
  for (const seat of rps.seats) {
    fadeTick(seat);
    rootTick(seat);
    ringTick(seat);
    if (seat.scene !== undefined) {
      sceneTick(seat, seat.scene);
      continue;
    }
    // The camera turns only while the player drags with the right mouse button (dragTick);
    // the automatic follow is off for now.
    if (floorMod(rps.ticks, 3) === 0) autoTargetTick(seat);
    seat.combatMs = combatAfter(seat.combatMs, CAMERA_PERIOD_MS, false);
    fightTick(seat, rps.ticks);
    if (seat.shakeMs > 0) {
      seat.shakeMs = Math.max(0, seat.shakeMs - CAMERA_PERIOD_MS);
      if (seat.shakeMs === 0 && isLocal(seat)) setNoise(0, 0);
    }
    if (moveNow) {
      issueMove(seat);
      holdGround(seat);
    }
    // Every client reads every hero, so only the camera natives differ between them.
    const heroX = GetUnitX(seat.hero), heroY = GetUnitY(seat.hero);
    const killCam = seat.killCam;
    if (killCam !== undefined && now() - killCam.start >= KILL_CAM_TICKS) seat.killCam = undefined;
    if (isLocal(seat)) {
      dragTick(seat);
      if (seat.killCam !== undefined) applyKillCam(seat, seat.killCam, heroX, heroY);
      else {
        if (killCam !== undefined) SetCameraTargetController(seat.hero, 0, 0, false);
        applyCamera(seat, heroX, heroY);
      }
    }
  }
  slowMotionTick();
}

// Combat: any damage the hero or the retinue deals or takes.

function setNoise(magnitude: number, velocity: number): void {
  CameraSetSourceNoise(magnitude, velocity);
  CameraSetTargetNoise(magnitude, velocity);
}

/** Sways the player's camera for 0.15 s; the camera tick calms it. */
function shake(seat: Seat): void {
  seat.shakeMs = SHAKE_MS;
  if (isLocal(seat)) setNoise(SHAKE_MAGNITUDE, SHAKE_VELOCITY);
}

/**
 * Damage puts the squad that dealt or took it in combat. The camera shakes on
 * impact: a siege hit landing within 500 of the hero, or the hero's own spell
 * damage (Storm Bolt, Thunder Clap) landing, which stands in for a critical
 * strike, since the Mountain King has none. His own melee (a swing or a
 * counter-slash, `meleeHit`) never shakes it.
 */
function damaged(): void {
  const victim = GetTriggerUnit();
  const source = GetEventDamageSource();
  const siege = BlzGetEventAttackType() === ATTACK_TYPE_SIEGE;
  const spell = !BlzGetEventIsAttack();
  for (const seat of state().seats) {
    if (victim === seat.hero && seat.fight.guardTick !== undefined) guardHit(seat, source);
    // A melee hero has no attack, so he would run from whatever hits him: he holds his ground. A ranged hero keeps
    // his attack, and holding would cancel it.
    if (victim === seat.hero && seat.heroInfo.ranged !== true && !moving(seat) && seat.fight.swing === undefined && seat.scene === undefined) IssueImmediateOrder(seat.hero, "holdposition");
    const ours = (target: unit) => target === seat.hero || seat.squad.some((member) => member.unit === target);
    if (ours(victim) || ours(source)) seat.combatMs = combatAfter(seat.combatMs, 0, true);
    const near = distanceSquared(pointOf(victim), pointOf(seat.hero)) <= SHAKE_RANGE * SHAKE_RANGE;
    if (state().meleeHit !== true && ((siege && near) || (spell && source === seat.hero))) shake(seat);
  }
}

// Manual combat: left click or Space swings, right click or Q held guards.

function now(): number {
  return state().ticks;
}

/** Moves a unit to a point, as Warcraft's pathing allows: SetUnitPosition finds the nearest place the unit fits, so a knockback never ends in a cliff or a tree. */
function shove(target: unit, to: Point): void {
  SetUnitPosition(target, to.x, to.y);
}

function swingAnimation(seat: Seat, step: number): void {
  const index = state().comboAnimations?.[step - 1];
  if (index !== undefined) SetUnitAnimationByIndex(seat.hero, index);
  else SetUnitAnimation(seat.hero, step === 3 ? "attack slam" : "attack");
}

/**
 * Starts a swing at the hero's front: the next combo step, the hero stopped
 * where he stands, still facing the way he was, and the attack animation at
 * 1.4 times speed. The damage lands IMPACT_TICKS later. The click only says
 * when to swing (`click` is kept for the buffer), not where.
 * (A lunge forward felt like a dash on every click, and the hero bumped back
 * off the unit he lunged into.)
 */
function startSwing(seat: Seat, click: Point | undefined): void {
  const { fight, hero } = seat;
  // Input buffer: a press in the last BUFFER_TICKS of a swing's recovery is
  // kept and swings the moment the recovery ends, so a combo flows without
  // exact timing; earlier presses are dropped, so spam can't outpace the swing.
  if (fight.swing !== undefined) {
    if (fight.swing.landed && bufferable(now(), fight.swing.recover)) fight.buffered = { click };
    return;
  }
  if (fight.guardTick !== undefined || !alive(hero) || !canAct(now(), fight.staggerUntil)) return;
  if (seat.heroInfo.ranged === true) return rangedAttack(seat);
  const tick = now();
  const step = nextComboStep(fight.step, fight.recoverTick, tick);
  const from = pointOf(hero);
  // With an enemy targeted the hero turns to him and strikes; without one he
  // strikes his own front. The click says when, never where.
  const target = seat.target !== undefined && alive(seat.target) ? pointOf(seat.target) : undefined;
  const facing = attackFacing(Math.floor(GetUnitFacing(hero) * 10), from, target);
  if (target !== undefined) BlzSetUnitFacingEx(hero, facing / 10);
  fight.swing = { facing, step, ...swingTicks(tick, fight.impactTicks, step), landed: false };
  fight.step = step;
  // Hold position, not stop: a unit without an attack runs from whatever hits
  // it, unless it is holding its ground, so a hit mid-swing can't send him off.
  IssueImmediateOrder(hero, "holdposition");
  // Reach correction: a melee hero steps in toward a target just out of reach,
  // stopping short of it, rather than swinging at air.
  const closer = stepIn(from, target, facing);
  if (closer !== undefined) shove(hero, closer);
  timeScale(hero, SWING_SPEED);
  swingAnimation(seat, step);
}

/**
 * A ranged hero's click or Space: Warcraft's own attack at his soft target,
 * with his own missile, range and cooldown; he closes in if it is out of
 * range. Without a target he holds his ground, where Warcraft's attack still
 * fires at enemies that come into range.
 */
function rangedAttack(seat: Seat): void {
  const { target, hero } = seat;
  if (target === undefined || !alive(target)) return;
  IssueTargetOrder(hero, "attack", target);
  seat.combatMs = combatAfter(seat.combatMs, 0, true);
}

/** The swing's damage lands on every enemy in its cone; hit units and the hero freeze for a moment, and the finisher knocks them back. */
function landSwing(seat: Seat, swing: Swing): void {
  const { hero, fight } = seat;
  swing.landed = true;
  const origin = pointOf(hero);
  const hits: unit[] = [];
  for (const other of unitsInRange(origin.x, origin.y, SWING_RANGE + 50)) {
    if (!alive(other) || !IsUnitEnemy(other, seat.player) || !inCone(origin, swing.facing, pointOf(other), SWING_RANGE, SWING_HALF_ANGLE)) continue;
    hits.push(other);
  }
  if (hits.length === 0) return;
  for (const target of hits) {
    state().meleeHit = true;
    UnitDamageTarget(hero, target, swingDamage(swing.step), true, false, ATTACK_TYPE_HERO, DAMAGE_TYPE_NORMAL, WEAPON_TYPE_METAL_HEAVY_SLICE);
    state().meleeHit = false;
    DestroyEffect(AddSpecialEffectTarget(SLASH_MODEL, target, "chest"));
    if (swing.step === 3) {
      const at = pointOf(target);
      shove(target, offset(at.x, at.y, swing.facing, FINISHER_KNOCKBACK, 0));
    }
  }
  seat.combatMs = combatAfter(seat.combatMs, 0, true);
  // Hit-stop: the hero and everything he hit hold still for HIT_STOP_TICKS.
  fight.frozen = [hero, ...hits];
  fight.thawTick = now() + HIT_STOP_TICKS;
  for (const target of fight.frozen) timeScale(target, 0);
}

/** Raises the guard: the hero stops, takes up the attack pose, which freezes GUARD_POSE_TICKS later, and slows to 3/5 speed. */
/** Floating text over a unit, rising and fading over 1.5 s, for everyone to see. */
function floatText(target: unit, text: string, red: number, green: number, blue: number): void {
  const tag = CreateTextTag();
  SetTextTagText(tag, text, FLOAT_TEXT_SIZE);
  SetTextTagPosUnit(tag, target, 0);
  SetTextTagColor(tag, red, green, blue, 255);
  SetTextTagVelocity(tag, 0, FLOAT_TEXT_RISE);
  SetTextTagPermanent(tag, false);
  SetTextTagLifespan(tag, 1.5);
  SetTextTagFadepoint(tag, 1.0);
}

/**
 * The guard pose: the model's combat stance ("stand ready"), or, once -guard
 * picked one, that animation frozen its ticks in. Played afresh, it is also a
 * block's recoil.
 */
function applyGuardPose(seat: Seat, speed: number = 1): void {
  const { fight, hero } = seat;
  timeScale(hero, speed);
  if (fight.guardPose === undefined) {
    SetUnitAnimation(hero, "stand ready");
    fight.poseTick = undefined;
  } else {
    SetUnitAnimationByIndex(hero, fight.guardPose.index);
    fight.poseTick = now() + fight.guardPose.freeze;
  }
}

function raiseGuard(seat: Seat): void {
  const { fight, hero } = seat;
  if (fight.guardTick !== undefined || !alive(hero) || !canAct(now(), fight.staggerUntil)) return;
  // Cancel window: once a swing's damage has landed, the guard cuts its recovery short.
  if (fight.swing !== undefined) {
    if (!fight.swing.landed) return;
    fight.swing = undefined;
    fight.buffered = undefined;
    fight.recoverTick = now();
  }
  fight.guardTick = now();
  SetUnitMoveSpeed(hero, floorDiv(fight.speed * GUARD_SPEED_NUMERATOR, GUARD_SPEED_DENOMINATOR));
  fight.guardEffect = AddSpecialEffectTarget(GUARD_MODEL, hero, "origin");
  // Raised on the move, the guard walks; standing, it takes up its pose.
  if (moving(seat)) timeScale(hero, GUARD_WALK_SPEED);
  else {
    IssueImmediateOrder(hero, "holdposition");
    applyGuardPose(seat);
  }
}

function lowerGuard(seat: Seat): void {
  const { fight, hero } = seat;
  if (fight.guardTick === undefined) return;
  fight.guardTick = undefined;
  fight.poseTick = undefined;
  if (fight.guardEffect !== undefined) DestroyEffect(fight.guardEffect);
  fight.guardEffect = undefined;
  timeScale(hero, 1);
  SetUnitMoveSpeed(hero, fight.speed);
  if (!moving(seat)) SetUnitAnimation(hero, "stand");
}

/** The guard follows the feet: walking at guard speed while a movement key is held, back in its pose when none is. */
function guardFootwork(seat: Seat): void {
  const { fight, hero } = seat;
  if (fight.guardTick === undefined) return;
  if (moving(seat)) {
    fight.poseTick = undefined;
    timeScale(hero, GUARD_WALK_SPEED);
  } else {
    IssueImmediateOrder(hero, "holdposition");
    applyGuardPose(seat);
  }
}

/**
 * A hit on the guarding hero: from his 130-degree front it is parried while
 * the guard is fresh (no damage, a spark, the attacker knocked back and a
 * quick counter-slash pose), blocked later (a fifth of the damage, 10 mana, a
 * small slide back) or, without the mana, breaks the guard. From behind it
 * lands in full.
 */
function guardHit(seat: Seat, attacker: unit): void {
  const { fight, hero } = seat;
  if (fight.guardTick === undefined || state().countering === true) return;
  const at = pointOf(hero), from = pointOf(attacker);
  const toAttacker = atan2Tenths(from.y - at.y, from.x - at.x);
  const mana = Math.floor(GetUnitState(hero, UNIT_STATE_MANA));
  const outcome = guardOutcome(now() - fight.guardTick, Math.floor(GetUnitFacing(hero) * 10), toAttacker, mana);
  if (outcome === "parry") {
    // No damage, a flash and "Parry!", the attacker knocked back, and a
    // counter-slash at twice speed that hits him and holds him still a moment.
    BlzSetEventDamage(0);
    DestroyEffect(AddSpecialEffectTarget(PARRY_MODEL, hero, "weapon"));
    DestroyEffect(AddSpecialEffectTarget(SLASH_MODEL, attacker, "chest"));
    floatText(hero, "Parry!", 255, 220, 80);
    shove(attacker, offset(from.x, from.y, toAttacker, PARRY_KNOCKBACK, 0));
    BlzSetUnitFacingEx(hero, toAttacker / 10);
    timeScale(hero, COUNTER_SPEED);
    SetUnitAnimation(hero, "attack");
    fight.poseTick = now() + GUARD_POSE_TICKS;
    fight.frozen = [attacker];
    fight.thawTick = now() + HIT_STOP_TICKS;
    timeScale(attacker, 0);
    // The counter is damage too; a guarding attacker mustn't parry it back into a loop.
    state().countering = true;
    state().meleeHit = true;
    UnitDamageTarget(hero, attacker, PARRY_COUNTER_DAMAGE, true, false, ATTACK_TYPE_HERO, DAMAGE_TYPE_NORMAL, WEAPON_TYPE_METAL_HEAVY_SLICE);
    state().meleeHit = false;
    state().countering = false;
  } else if (outcome === "block") {
    // A fifth of the damage, 10 mana, a flash, a slide back and the pose jolted
    // back into motion for a moment.
    BlzSetEventDamage(blockedDamage(GetEventDamage()));
    SetUnitState(hero, UNIT_STATE_MANA, mana - BLOCK_MANA);
    DestroyEffect(AddSpecialEffectTarget(BLOCK_MODEL, hero, "chest"));
    shove(hero, offset(at.x, at.y, toAttacker + 1800, 35, 0));
    if (!moving(seat)) {
      applyGuardPose(seat, RECOIL_SPEED);
      if (fight.guardPose !== undefined) fight.poseTick = now() + RECOIL_TICKS;
    }
  } else if (outcome === "broken") {
    // Out of mana: the guard breaks and the hero staggers.
    lowerGuard(seat);
    fight.staggerUntil = now() + STAGGER_TICKS;
    IssueImmediateOrder(hero, "holdposition");
    SetUnitAnimation(hero, "stand hit");
    floatText(hero, "Guard broken!", 255, 80, 60);
    say(seat, "Guard broken: not enough mana.");
  }
}

/** Every camera tick: a swing lands and ends on its ticks, hit-stop thaws, and a raised guard freezes in its pose. */
function fightTick(seat: Seat, tick: number): void {
  const { fight, hero } = seat;
  const { swing, pending } = fight;
  if (pending !== undefined && tick >= pending.tick + CLICK_SETTLE_TICKS) {
    fight.pending = undefined;
    if (!isSpellBarClick(pending.tick, fight.barTick)) startSwing(seat, pending.click);
  }
  if (swing !== undefined && !swing.landed && tick >= swing.impact) landSwing(seat, swing);
  if (fight.frozen.length > 0 && tick >= fight.thawTick) {
    for (const target of fight.frozen) timeScale(target, target === hero && fight.swing !== undefined ? SWING_SPEED : 1);
    fight.frozen = [];
  }
  if (swing !== undefined && fight.swing === swing && tick >= swing.recover) {
    fight.swing = undefined;
    fight.recoverTick = tick;
    timeScale(hero, 1);
    const { buffered } = fight;
    fight.buffered = undefined;
    if (buffered !== undefined) startSwing(seat, buffered.click);
  }
  if (fight.poseTick !== undefined && tick >= fight.poseTick) {
    fight.poseTick = undefined;
    if (fight.guardTick !== undefined && !moving(seat)) timeScale(hero, 0);
  }
}

/** Mouse: a left press swings toward the clicked ground (after CLICK_SETTLE_TICKS). */
function mouse(down: boolean): void {
  const seat = seatOf(GetTriggerPlayer());
  if (seat === undefined || seat.scene !== undefined) return;
  const button = BlzGetTriggerPlayerMouseButton();
  if (button === MOUSE_BUTTON_TYPE_LEFT && down) {
    const x = Math.floor(BlzGetTriggerPlayerMouseX()), y = Math.floor(BlzGetTriggerPlayerMouseY());
    // A click off the terrain (the sky, say) reads as the origin: aim along the camera then.
    // It swings CLICK_SETTLE_TICKS later, unless it turns out to be a spell bar click.
    seat.fight.pending = { click: x === 0 && y === 0 ? undefined : { x, y }, tick: now() };
  }
  // The right button turns the camera while held (dragTick); the guard is on Q.
}

/** "-impact N" makes swings land N ticks in; "-anim N" plays animation N of the hero's model, to find its swing animations; "-combo A B C" swings with those three, "-combo" alone goes back to the attack animations by name. */
function animationCommand(): void {
  const seat = seatOf(GetTriggerPlayer());
  if (seat === undefined) return;
  const [command, ...numbers] = GetEventPlayerChatString().split(" ");
  const indices = numbers.filter((word) => word !== "").map((word) => S2I(word));
  if (command === "-anim") {
    const index = indices[0] ?? 0;
    SetUnitAnimationByIndex(seat.hero, index);
    say(seat, `Animation ${index}.`);
  } else if (command === "-guard") {
    // -guard N T: animation N, frozen T ticks in, as the guard pose; -guard alone: "stand ready".
    const index = indices[0];
    seat.fight.guardPose = index === undefined ? undefined : { index, freeze: Math.max(0, Math.min(30, indices[1] ?? 4)) };
    say(seat, seat.fight.guardPose === undefined ? "Guard pose: stand ready." : `Guard pose: animation ${seat.fight.guardPose.index}, frozen ${seat.fight.guardPose.freeze} ticks in.`);
    if (seat.fight.guardTick !== undefined && !moving(seat)) applyGuardPose(seat);
  } else if (command === "-impact") {
    // The tick, 0.03 s each, the weapon visibly connects in the swing animation; 2 to 20.
    seat.fight.impactTicks = Math.max(2, Math.min(20, indices[0] ?? IMPACT_TICKS));
    say(seat, `Swings land ${seat.fight.impactTicks} ticks in (${seat.fight.impactTicks * 30} ms).`);
  } else {
    state().comboAnimations = indices.length === 3 ? indices : undefined;
    say(seat, indices.length === 3 ? `Swings play animations ${indices.join(", ")}.` : "Swings play the attack animations by name.");
  }
}

// Trees between the camera and the hero: 0.1 s.

function setShown(seat: Seat, trees: readonly destructable[], shown: boolean): void {
  if (!isLocal(seat)) return;
  for (const tree of trees) ShowDestructable(tree, shown);
}

function occlusionTick(): void {
  const rps = state();
  for (const seat of rps.seats) {
    const hero = pointOf(seat.hero);
    const eye = eyePoint(hero, seat.yaw.current, cameraOf(seat));
    SetRect(rps.rect,
      Math.min(eye.x, hero.x) - OCCLUSION_RADIUS, Math.min(eye.y, hero.y) - OCCLUSION_RADIUS,
      Math.max(eye.x, hero.x) + OCCLUSION_RADIUS, Math.max(eye.y, hero.y) + OCCLUSION_RADIUS);
    const blocking: destructable[] = [];
    EnumDestructablesInRect(rps.rect, rps.everything, () => {
      const tree = GetEnumDestructable();
      const at = { x: Math.floor(GetDestructableX(tree)), y: Math.floor(GetDestructableY(tree)) };
      if (GetDestructableLife(tree) > 0 && occludes(eye, hero, at)) blocking.push(tree);
    });
    setShown(seat, seat.hidden.filter((tree) => !blocking.includes(tree)), true);
    setShown(seat, blocking.filter((tree) => !seat.hidden.includes(tree)), false);
    seat.hidden = blocking;
  }
}

// Squad: stances every 0.5 s, Tab targets, F attacks.

function dropTarget(seat: Seat): void {
  if (seat.ring !== undefined) DestroyImage(seat.ring.image);
  seat.ring = undefined;
  if (seat.target !== undefined && isLocal(seat)) SetUnitVertexColor(seat.target, 255, 255, 255, 255);
  seat.target = undefined;
}

/**
 * Marks the soft target for its player: a red ring on the ground under it,
 * sized to it (`ringSize`), and a red cast over the unit itself. Every client
 * makes the same ring; only the targeting player's shows it, and only his
 * client tints the unit.
 */
function markTarget(seat: Seat, target: unit): void {
  dropTarget(seat);
  seat.target = target;
  if (isLocal(seat) && !off("tint")) SetUnitVertexColor(target, TARGET_TINT.red, TARGET_TINT.green, TARGET_TINT.blue, 255);
  if (off("ring")) return;
  const size = ringSize(BlzGetUnitCollisionSize(target));
  const corner = ringCorner(pointOf(target), size);
  const image = CreateImage(RING_TEXTURE, size, size, 0, corner.x, corner.y, 0, 0, 0, 0, IMAGE_TYPE_SELECTION);
  SetImageColor(image, 255, 40, 40, 220);
  SetImageRenderAlways(image, true);
  ShowImage(image, false);
  if (isLocal(seat)) ShowImage(image, true);
  seat.ring = { image, size };
}

/** Every camera tick: the ring follows its target. */
function ringTick(seat: Seat): void {
  const { ring, target } = seat;
  if (ring === undefined || target === undefined) return;
  const corner = ringCorner(pointOf(target), ring.size);
  SetImagePosition(ring.image, corner.x, corner.y, 0);
}

/**
 * Every 3 camera ticks: a hero without a living, visible target within 900
 * picks one on his own, the enemy within 700 best placed ahead of the camera
 * (`autoTarget`). A target he has keeps until it dies or leaves 900, so Tab's
 * choice sticks.
 */
function autoTargetTick(seat: Seat): void {
  if (seat.scene !== undefined) return;
  const hero = pointOf(seat.hero);
  const { target } = seat;
  if (target !== undefined && alive(target) && IsUnitVisible(target, seat.player)
    && distanceSquared(hero, pointOf(target)) <= TARGET_RANGE * TARGET_RANGE) return;
  const enemies = unitsInRange(hero.x, hero.y, AUTO_TARGET_RANGE)
    .filter((other) => alive(other) && IsUnitEnemy(other, seat.player) && IsUnitVisible(other, seat.player));
  const best = autoTarget(hero, enemies.map((other) => pointOf(other)), seat.yaw.current);
  const chosen = best === undefined ? undefined : enemies[best];
  if (chosen !== undefined) markTarget(seat, chosen);
  else if (target !== undefined) dropTarget(seat);
}

function cycleTarget(seat: Seat): void {
  const hero = pointOf(seat.hero);
  const byId = new Map<number, unit>();
  const candidates: Candidate[] = [];
  for (const other of unitsInRange(hero.x, hero.y, TARGET_RANGE)) {
    if (!alive(other) || !IsUnitEnemy(other, seat.player) || !IsUnitVisible(other, seat.player)) continue;
    const id = GetHandleId(other);
    byId.set(id, other);
    candidates.push({ id, distanceSquared: distanceSquared(hero, pointOf(other)) });
  }
  const next = nextTarget(candidates, seat.target === undefined ? undefined : GetHandleId(seat.target));
  const target = next === undefined ? undefined : byId.get(next);
  if (target === undefined) {
    dropTarget(seat);
    say(seat, "No visible enemy within 900.");
  } else markTarget(seat, target);
}

function attackTarget(seat: Seat): void {
  const { target } = seat;
  if (target === undefined || !alive(target)) {
    say(seat, "No target: press Tab first.");
    return;
  }
  for (const member of seat.squad) if (alive(member.unit)) IssueTargetOrder(member.unit, "attack", target);
  // The squad is in combat from the order on, so the stance tick doesn't call it back mid-swing.
  seat.combatMs = combatAfter(seat.combatMs, 0, true);
}

function setStance(seat: Seat, stance: Stance): void {
  seat.stance = stance;
  say(seat, stance === "vanguard" ? "Stance: Vanguard. Melee in front, ranged behind." : "Stance: Tight Guard. The squad stays by the hero.");
}

/**
 * The nearest item lying on the ground within PICKUP_RANGE of the hero, and
 * its squared distance. Every client enumerates the same items in the same
 * order, so every client finds the same one.
 */
function nearestLoot(seat: Seat): { readonly item: item; readonly distanceSquared: number } | undefined {
  if (!alive(seat.hero) || seat.scene !== undefined) return undefined;
  const rps = state();
  const hero = pointOf(seat.hero);
  SetRect(rps.rect, hero.x - PICKUP_RANGE, hero.y - PICKUP_RANGE, hero.x + PICKUP_RANGE, hero.y + PICKUP_RANGE);
  const found: item[] = [];
  EnumItemsInRect(rps.rect, rps.everything, () => {
    found.push(GetEnumItem());
  });
  let nearest: { readonly item: item; readonly distanceSquared: number } | undefined;
  for (const loot of found) {
    if (!IsItemVisible(loot) || IsItemOwned(loot)) continue;
    const distance = distanceSquared(hero, { x: Math.floor(GetItemX(loot)), y: Math.floor(GetItemY(loot)) });
    if (distance <= PICKUP_RANGE * PICKUP_RANGE && (nearest === undefined || distance < nearest.distanceSquared)) nearest = { item: loot, distanceSquared: distance };
  }
  return nearest;
}

/** What E reaches now: the nearer of an NPC to talk to and an item to pick up (`interaction`), with the NPC and item themselves. */
function reachOf(seat: Seat): { readonly reach: Reachable | undefined; readonly npc: Npc | undefined; readonly loot: item | undefined } {
  const npc = talkTarget(seat), loot = nearestLoot(seat);
  const reach = interaction(
    npc === undefined ? undefined : { kind: "talk", name: npc.npc.name, distanceSquared: npc.distanceSquared },
    loot === undefined ? undefined : { kind: "pickUp", name: GetItemName(loot.item), distanceSquared: loot.distanceSquared },
  );
  return { reach, npc: npc?.npc, loot: loot?.item };
}

/**
 * E, the interact key: talks to the nearest NPC in talking range or picks up
 * the nearest item in reach, whichever is nearer. Nothing is ever selected and
 * the right mouse button turns the camera, so Warcraft's own right-click
 * pickup and talk never happen. A power-up (a tome, gold coins) is used at
 * once; anything else goes into the inventory if it has room.
 */
function interact(seat: Seat): void {
  const { reach, npc, loot } = reachOf(seat);
  if (reach?.kind === "talk" && npc !== undefined) return startScene(seat, npc);
  if (reach?.kind !== "pickUp" || loot === undefined) return;
  const powerup = IsItemPowerup(loot);
  const name = GetItemName(loot);
  if (!powerup && UnitInventoryCount(seat.hero) >= UnitInventorySize(seat.hero)) return say(seat, `Your inventory is full: ${name} stays on the ground.`);
  if (UnitAddItem(seat.hero, loot)) say(seat, powerup ? `You use ${name}.` : `You pick up ${name}.`);
}

/** The inventory's button or I: opens or closes it. A click and a key reach every client, so every client agrees. */
function toggleInventory(seat: Seat): void {
  seat.inventoryOpen = seat.inventoryOpen !== true;
}

/** A click on an inventory slot uses its item: on its own, or else at the soft target. */
function useItem(seat: Seat, slot: number): void {
  const held = UnitItemInSlot(seat.hero, slot) as item | undefined;
  if (held === undefined) return;
  const used = UnitUseItem(seat.hero, held) || (seat.target !== undefined && UnitUseItemTarget(seat.hero, held, seat.target));
  if (!used) say(seat, `${GetItemName(held)} can't be used now.`);
}

/** The hero's inventory as its panel shows it: each slot's icon and charges. */
function itemViews(seat: Seat): ItemView[] {
  const views: ItemView[] = [];
  for (let slot = 0; slot < INVENTORY_SLOTS; slot++) {
    const held = UnitItemInSlot(seat.hero, slot) as item | undefined;
    const charges = held === undefined ? 0 : GetItemCharges(held);
    views.push({ icon: held === undefined ? "" : BlzGetItemIconPath(held), charges: charges > 0 ? `${charges}` : "" });
  }
  return views;
}

function stanceTick(): void {
  questTick();
  for (const seat of state().seats) {
    if (seat.scene !== undefined) continue;
    talkCheck(seat);
    if (seat.target !== undefined && !alive(seat.target)) dropTarget(seat);
    if (!alive(seat.hero)) continue;
    const hero = pointOf(seat.hero);
    const living = seat.squad.filter((member) => alive(member.unit));
    const counts = { melee: living.filter((member) => member.role === "melee").length, ranged: living.filter((member) => member.role === "ranged").length };
    const ranks = { melee: 0, ranged: 0 };
    const inCombat = seat.combatMs > 0;
    living.forEach((member, index) => {
      const slot = seat.stance === "vanguard"
        ? vanguardSlot(hero, seat.yaw.current, member.role, ranks[member.role]++, counts[member.role])
        : guardSlot(hero, seat.yaw.current, index, living.length);
      if (!needsRegroup(seat.stance, pointOf(member.unit), slot, hero, inCombat)) return;
      // Out of combat the squad walks to its slots; in combat only a unit past the
      // leash is ordered, and it fights its way back.
      IssuePointOrder(member.unit, inCombat ? "attack" : "move", slot.x, slot.y);
    });
  }
}

// Spells: 3, 4 and 5 or a click on the spell bar cast; a click on a slot's
// learn button, or L for the next skill, learns.

function ranksOf(seat: Seat): SkillRanks {
  const level = (index: number) => GetUnitAbilityLevel(seat.hero, rawcode(seat.heroInfo.skills[index]?.code ?? "Aatk"));
  return [level(0), level(1), level(2), level(3)];
}

/** Learns a skill's next rank, if the hero has a point and his level allows it. */
function learn(seat: Seat, index: number): void {
  const skill = seat.heroInfo.skills[index];
  if (skill === undefined) return;
  if (GetHeroSkillPoints(seat.hero) <= 0) say(seat, "No skill points to spend.");
  else if (!canLearn(index, GetHeroLevel(seat.hero), ranksOf(seat))) say(seat, `${skill.name} can't be learned yet.`);
  else SelectHeroSkill(seat.hero, rawcode(skill.code));
}

/** L: learns the next skill by nextSkill, basic skills in turn and the ultimate at level 6. */
function learnNext(seat: Seat): void {
  const index = GetHeroSkillPoints(seat.hero) > 0 ? nextSkill(GetHeroLevel(seat.hero), ranksOf(seat)) : undefined;
  if (index === undefined) say(seat, "No skill points to spend.");
  else learn(seat, index);
}

function leveled(): void {
  const seat = seatOf(GetOwningPlayer(GetTriggerUnit()));
  if (seat === undefined || GetTriggerUnit() !== seat.hero) return;
  say(seat, `Level ${GetHeroLevel(seat.hero)}: a skill point to spend. Click a + on the spell bar, or press L.`);
}

/** The squad member with the least health for its maximum, for healing spells; the hero when the squad is gone. */
function mostHurt(seat: Seat): unit {
  let best = seat.hero, bestPercent = 101;
  for (const member of seat.squad) {
    if (!alive(member.unit)) continue;
    const percent = percentOf(GetUnitState(member.unit, UNIT_STATE_LIFE), GetUnitState(member.unit, UNIT_STATE_MAX_LIFE));
    if (percent < bestPercent) {
      best = member.unit;
      bestPercent = percent;
    }
  }
  return best;
}

/**
 * Casts the hero's skill by its targeting: at the Tab target, on the most
 * hurt squad member, on himself, at the Tab target's spot or 400 ahead along
 * the camera, or at once. Orders reach the hero without selecting him.
 */
function castSkill(seat: Seat, index: number): void {
  const skill = seat.heroInfo.skills[index];
  if (skill === undefined) return;
  const { hero, target } = seat;
  const fail = () => say(seat, `${skill.name} can't be cast now: not learned, recharging or out of mana.`);
  if (skill.targeting === "passive") say(seat, `${skill.name} is passive.`);
  else if (skill.targeting === "instant") {
    if (!IssueImmediateOrder(hero, skill.order)) fail();
  } else if (skill.targeting === "enemy") {
    if (target === undefined || !alive(target)) say(seat, "No target: press Tab first.");
    else if (!IssueTargetOrder(hero, skill.order, target)) fail();
  } else if (skill.targeting === "ally" || skill.targeting === "self") {
    if (!IssueTargetOrder(hero, skill.order, skill.targeting === "self" ? hero : mostHurt(seat))) fail();
  } else {
    const from = pointOf(hero);
    const at = target !== undefined && alive(target) ? pointOf(target) : offset(from.x, from.y, seat.yaw.current, 400, 0);
    if (!IssuePointOrder(hero, skill.order, at.x, at.y)) fail();
  }
}

// The interface: every 0.1 s, every player's, the same in every client.

function slotView(seat: Seat, skill: Skill, index: number, ranks: SkillRanks, level: number, points: number): SlotView {
  const rank = ranks[index] ?? 0;
  const remaining = rank > 0 ? BlzGetUnitAbilityCooldownRemaining(seat.hero, rawcode(skill.code)) : 0;
  return {
    icon: rank > 0 ? icon(skill.icon) : disabledIcon(skill.icon),
    key: skill.targeting === "passive" ? "" : SKILL_KEYS[index] ?? "",
    rank: rankText(index, rank),
    cooldown: remaining > 0 ? `${Math.ceil(remaining)}` : "",
    learnable: points > 0 && canLearn(index, level, ranks),
  };
}

function hudTick(): void {
  for (const seat of state().seats) {
    const { hud, hero } = seat;
    if (hud === undefined) continue;
    const life = Math.floor(GetUnitState(hero, UNIT_STATE_LIFE)), maxLife = Math.floor(GetUnitState(hero, UNIT_STATE_MAX_LIFE));
    const ranks = ranksOf(seat), level = GetHeroLevel(hero), points = GetHeroSkillPoints(hero);
    showHud(hud, {
      life, maxLife, lifePercent: percentOf(life, maxLife),
      manaPercent: percentOf(GetUnitState(hero, UNIT_STATE_MANA), GetUnitState(hero, UNIT_STATE_MAX_MANA)),
      slots: seat.heroInfo.skills.map((skill, index) => slotView(seat, skill, index, ranks, level, points)),
      quests: journalText(activeQuests(flagsOf(seat))),
      hint: interactHint(reachOf(seat).reach),
      inventoryOpen: seat.inventoryOpen === true,
      items: itemViews(seat),
    });
    // Warcraft's own quest log (F9) follows the same flags, once any scene is over, so its messages don't cover the dialogue.
    if (seat.scene === undefined) syncQuestLog(seat, questLog(flagsOf(seat)));
  }
}

/** A click on the spell bar: a slot casts its skill, a learn button learns it. */
function hudClick(): void {
  const seat = seatOf(GetTriggerPlayer());
  const clicked = BlzGetTriggerFrame();
  // Give the keyboard back to the game, so WASD keeps working after a click.
  BlzFrameSetEnable(clicked, false);
  BlzFrameSetEnable(clicked, true);
  if (seat === undefined) {
    pickClick(GetTriggerPlayer(), GetHandleId(clicked));
    return;
  }
  if (seat.scene !== undefined) {
    const choice = seat.letterbox === undefined ? undefined : choiceOf(seat.letterbox, GetHandleId(clicked));
    if (choice !== undefined) chooseLine(seat, seat.scene, choice);
    return;
  }
  if (seat.hud === undefined) return;
  // The same click also reached the world as a mouse press; it mustn't swing.
  seat.fight.barTick = now();
  const action = hudAction(seat.hud, GetHandleId(clicked));
  if (action === undefined) return;
  if (action.kind === "inventory") toggleInventory(seat);
  else if (action.kind === "use") useItem(seat, action.slot);
  else if (action.kind === "learn") learn(seat, action.slot);
  else castSkill(seat, action.slot);
}

// Keys: one trigger for presses and one for releases, each for every key.

/** Switches the player's camera to a preset; the camera tick eases to it. */
function setCamera(seat: Seat, preset: number): void {
  seat.camera = preset;
  say(seat, describeCamera(cameraOf(seat)));
}

function key(down: boolean): void {
  const seat = seatOf(GetTriggerPlayer());
  const code = GetHandleId(BlzGetTriggerPlayerKey());
  if (seat === undefined) {
    if (down) pickKey(GetTriggerPlayer(), code);
    return;
  }
  if (seat.scene !== undefined) {
    // In a scene, Space reveals or skips the line, 1 to 4 choose and Esc ends it; nothing else acts.
    if (!down) return;
    if (code === KEY.space) skipLine(seat, seat.scene);
    else if (code === KEY.escape) endScene(seat, seat.scene);
    else if (PICK_KEYS.includes(code)) chooseLine(seat, seat.scene, PICK_KEYS.indexOf(code));
    return;
  }
  const { keys } = seat;
  if (code === KEY.q) {
    if (down) raiseGuard(seat);
    else lowerGuard(seat);
  } else if (code === KEY.w || code === KEY.a || code === KEY.s || code === KEY.d) {
    if (code === KEY.w) keys.w = down;
    else if (code === KEY.a) keys.a = down;
    else if (code === KEY.s) keys.s = down;
    else keys.d = down;
    if (down) issueMove(seat);
    if (seat.fight.guardTick !== undefined) guardFootwork(seat);
  } else if (!down) return;
  else if (code === KEY.tab) cycleTarget(seat);
  else if (code === KEY.e) interact(seat);
  else if (code === KEY.i) toggleInventory(seat);
  else if (code === KEY.f) attackTarget(seat);
  else if (code === KEY.one) setStance(seat, "vanguard");
  else if (code === KEY.two) setStance(seat, "guard");
  else if (SKILL_KEY_CODES.includes(code)) castSkill(seat, SKILL_KEY_CODES.indexOf(code));
  else if (code === KEY.l) learnNext(seat);
  else if (code === KEY.space) startSwing(seat, undefined);
  else if (CAMERA_KEYS.includes(code)) setCamera(seat, CAMERA_KEYS.indexOf(code));
}

// Personal scenes (./scenes.ts, ./questRuntime.ts): where this map's NPCs
// stand, and what the scene engine asks of the map (`installScenes` in
// install()): its hero standing down, his party, his placeholders, recruits
// and its interface giving way to the letterbox.

/** Places an NPC for every scene: by each tavern the base map has, facing the center, or near the center without one. */
function placeNpcs(centerX: number, centerY: number): void {
  const rps = state();
  GroupEnumUnitsInRect(rps.group, bj_mapInitialPlayableArea, rps.everything);
  const taverns: Point[] = [];
  const size = BlzGroupGetSize(rps.group);
  for (let index = 0; index < size; index++) {
    const placed = BlzGroupUnitAt(rps.group, index);
    if (GetUnitTypeId(placed) === TAVERN) taverns.push(pointOf(placed));
  }
  const center = { x: Math.floor(centerX), y: Math.floor(centerY) };
  const spots = taverns.length > 0
    ? taverns.map((tavern) => offset(tavern.x, tavern.y, atan2Tenths(center.y - tavern.y, center.x - tavern.x), 300, 0))
    : [{ x: center.x, y: center.y - 300 }];
  for (const spot of spots) {
    const npc = CreateUnit(Player(PLAYER_NEUTRAL_PASSIVE), rawcode(TAVERN_SCENE.npcCode), spot.x, spot.y, 270.0);
    BlzSetUnitName(npc, TAVERN_SCENE.npcName);
    SetUnitInvulnerable(npc, true);
    rps.npcs.push({ unit: npc, scene: TAVERN_SCENE, name: TAVERN_SCENE.npcName, code: TAVERN_SCENE.npcCode, extras: [] });
  }
}

/**
 * The wandering NPCs (`WANDERERS`): each around the playable area's center,
 * facing it, put where Warcraft's pathing lets a unit stand.
 */
function placeWanderers(center: Point): void {
  const rps = state();
  for (const wanderer of WANDERERS) {
    const { scene } = wanderer;
    const spot = offset(center.x, center.y, wanderer.angle, wanderer.distance, 0);
    const npc = CreateUnit(Player(PLAYER_NEUTRAL_PASSIVE), rawcode(scene.npcCode), spot.x, spot.y, (wanderer.angle + 1800) / 10);
    shove(npc, spot);
    BlzSetUnitName(npc, scene.npcName);
    SetUnitInvulnerable(npc, true);
    rps.npcs.push({ unit: npc, scene, name: scene.npcName, code: scene.npcCode, extras: [] });
  }
}

/** A quartermaster of the player's race stands 400 from his start toward the center, recruiting for the hero (RECRUIT_SCENE). */
function placeQuartermaster(seat: Seat, start: Point): void {
  const rps = state();
  const code = seat.race.army.find((soldier) => soldier.role === "melee")?.code ?? RECRUIT_SCENE.npcCode;
  const spot = offset(start.x, start.y, atan2Tenths(rps.center.y - start.y, rps.center.x - start.x), 400, 0);
  const npc = CreateUnit(Player(PLAYER_NEUTRAL_PASSIVE), rawcode(code), spot.x, spot.y, (atan2Tenths(start.y - spot.y, start.x - spot.x)) / 10);
  BlzSetUnitName(npc, RECRUIT_SCENE.npcName);
  SetUnitInvulnerable(npc, true);
  rps.npcs.push({ unit: npc, scene: RECRUIT_SCENE, name: RECRUIT_SCENE.npcName, code, extras: [] });
}

/** What `-off` can switch off, to find which part of the map changes how something looks. */
const SWITCHES = ["tint", "ring", "slowmo", "killcam", "talk", "fade", "marks", "root"] as const;

/** Whether `-off` has switched a part of the map off. */
function off(feature: string): boolean {
  return state().off?.has(feature) === true;
}

/**
 * "-off tint" or "-on tint": switches a recent visual part of the map off or
 * back on for every player (`SWITCHES`, or "all"), from the next time it
 * would act; "-off" alone lists them and what is off.
 */
function switchCommand(): void {
  const rps = state();
  const switched = rps.off ?? new Set<string>();
  rps.off = switched;
  const words = GetEventPlayerChatString().split(" ");
  const turnOff = words[0] === "-off";
  const name = words[1] ?? "";
  const names: readonly string[] = name === "all" ? SWITCHES : SWITCHES.filter((feature) => feature === name);
  for (const feature of names) {
    if (turnOff) switched.add(feature);
    else switched.delete(feature);
  }
  const list = SWITCHES.map((feature) => (switched.has(feature) ? `${feature} (off)` : feature)).join(", ");
  sayAll(names.length === 0 ? `Switches: ${list}. Type -off NAME or -on NAME, or all.` : `${turnOff ? "Off" : "On"}: ${names.join(", ")}. Now: ${list}.`);
}

/**
 * "-time 12": sets the time of day to that hour (0 to 23; noon without one),
 * for every player, to see the map by day and by night: Warcraft's night
 * light turns shiny armor dark blue and purple.
 */
function timeCommand(): void {
  const words = GetEventPlayerChatString().split(" ");
  const asked = words[1] === undefined || words[1] === "" ? 12 : S2I(words[1]);
  const hour = Math.min(Math.max(asked, 0), 23);
  SetFloatGameState(GAME_STATE_TIME_OF_DAY, hour);
  sayAll(`Time of day: ${hour}:00.`);
}

/** "-scene": plays the nearest NPC's scene wherever the hero is, for trying scenes out. */
function sceneCommand(): void {
  const seat = seatOf(GetTriggerPlayer());
  if (seat !== undefined) playNearest(seat);
}

/**
 * The quest sites (`QUEST_SITES`): each NPC around the playable area's center,
 * facing it, with his company in rings around him, all put where Warcraft's
 * pathing lets them stand. They can't be hurt until they turn.
 */
function placeQuestSites(center: Point): void {
  const rps = state();
  for (const site of QUEST_SITES) {
    const { scene } = site;
    const spot = offset(center.x, center.y, site.angle, site.distance, 0);
    const npc = CreateUnit(Player(PLAYER_NEUTRAL_PASSIVE), rawcode(scene.npcCode), spot.x, spot.y, (site.angle + 1800) / 10);
    shove(npc, spot);
    BlzSetUnitName(npc, scene.npcName);
    SetUnitInvulnerable(npc, true);
    const extras: unit[] = [];
    for (const extra of site.extras) {
      for (let index = 0; index < extra.count; index++) {
        const angle = floorDiv(index * 3600, extra.count) + site.angle;
        const at = offset(spot.x, spot.y, angle, extra.radius, 0);
        const unit = CreateUnit(Player(PLAYER_NEUTRAL_PASSIVE), rawcode(extra.code), at.x, at.y, (site.angle + 1800) / 10);
        shove(unit, at);
        SetUnitInvulnerable(unit, true);
        extras.push(unit);
      }
    }
    rps.npcs.push({ unit: npc, scene, name: scene.npcName, code: scene.npcCode, extras });
  }
}

/** What a scene's placeholders read for this player: his hero's name and his race's soldiers. */
function lineValues(seat: Seat): Readonly<Record<string, string>> {
  const plural = (role: Role) => seat.race.army.find((soldier) => soldier.role === role)?.plural ?? "soldiers";
  return { hero: seat.heroInfo.name, melee: plural("melee"), ranged: plural("ranged") };
}

/**
 * Recruits a role's soldiers from the hero's race into his party, two by his
 * side, for their cost: not again while he leads them, nor without the gold.
 */
function recruit(seat: Seat, role: Role, cost: number): void {
  const soldiers = seat.race.army.filter((soldier) => soldier.role === role);
  const name = soldiers[0]?.plural ?? "soldiers";
  const gold = goldOf(seat);
  const outcome = recruitOutcome(gold, cost, seat.squad.some((member) => member.role === role && alive(member.unit)));
  if (outcome === "already") return say(seat, `You already lead ${name}.`);
  if (outcome === "poor") return say(seat, `Not enough gold: ${name} cost ${cost}.`);
  SetPlayerState(seat.player, PLAYER_STATE_RESOURCE_GOLD, gold - cost);
  const at = pointOf(seat.hero);
  soldiers.forEach((soldier, index) => {
    const spot = offset(at.x, at.y, seat.yaw.current + 1800, 120, (index * 2 - 1) * 90);
    seat.squad.push({ unit: CreateUnit(seat.player, rawcode(soldier.code), spot.x, spot.y, seat.yaw.current / 10), role });
  });
  say(seat, `Two ${name} join you.`);
}

// Picking: each player's race is the one he chose in Warcraft's lobby; he
// chooses his race's heroes or the tavern's, then a hero, by click or with
// 1 to 4 (0 goes back); PICK_SECONDS in, whoever hasn't gets the first hero
// of the list he is looking at, or of his race's.

function pickOf(target: player): Pick | undefined {
  const id = GetPlayerId(target);
  return state().picks.find((pick) => pick.id === id && !pick.done);
}

/**
 * The race a player chose in Warcraft's own lobby, as an index into RACES:
 * Human, Orc, Night Elf or Undead (a random race is settled before the map
 * starts). Anything else plays as Human.
 */
function gameRace(target: player): number {
  const race = GetPlayerRace(target);
  return race === RACE_ORC ? 1 : race === RACE_NIGHTELF ? 2 : race === RACE_UNDEAD ? 3 : 0;
}

function showPick(pick: Pick): void {
  if (pick.list === undefined) showPicker(pick.menu, "Choose your hero", heroListNames(pick.race), false);
  else showPicker(pick.menu, pick.list === 0 ? `Choose your ${raceOf(pick.race).name} hero` : "Choose a tavern hero", heroList(pick.race, pick.list).map((hero) => hero.name), true);
}

/** A choice (0 to 3) or "back" on a player's picker: a hero list, then a hero, which spawns them. */
function choose(pick: Pick, choice: number | "back"): void {
  if (choice === "back") pick.list = undefined;
  else if (pick.list === undefined) {
    if (choice >= HERO_LISTS) return;
    pick.list = choice;
  } else {
    const hero = heroList(pick.race, pick.list)[choice];
    if (hero !== undefined) finishPick(pick, hero);
    return;
  }
  showPick(pick);
}

function pickClick(target: player, clickedId: number): void {
  const pick = pickOf(target);
  const choice = pick === undefined ? undefined : pickerAction(pick.menu, clickedId);
  if (pick !== undefined && choice !== undefined) choose(pick, choice);
}

function pickKey(target: player, code: number): void {
  const pick = pickOf(target);
  if (pick === undefined) return;
  if (code === KEY.zero) choose(pick, "back");
  else if (PICK_KEYS.includes(code)) choose(pick, PICK_KEYS.indexOf(code));
}

/** The pick time is up: everyone still choosing gets the first hero of the list he is looking at, or of his race's. */
function pickTimeout(): void {
  for (const pick of state().picks) {
    if (pick.done) continue;
    finishPick(pick, heroList(pick.race, pick.list ?? 0)[0] ?? heroOf(DEFAULT_PICK.race, DEFAULT_PICK.hero));
  }
}

/** Spawns the picked hero on the player's start location, with his race's army to recruit, and hands them the interface. */
function finishPick(pick: Pick, hero: Hero): void {
  const rps = state();
  pick.done = true;
  BlzFrameSetVisible(pick.menu.root, false);
  const start = startOf(pick.id);
  const seat = spawnSeat(pick.id, start.x, start.y, raceOf(pick.race), hero);
  rps.seats.push(seat);
  placeQuartermaster(seat, start);
  seat.hud = createHud(seat.id, rps.clicks);
  seat.letterbox = createLetterbox(seat.id, rps.clicks);
  BlzFrameSetVisible(seat.hud.root, isLocal(seat));
  const heroX = GetUnitX(seat.hero), heroY = GetUnitY(seat.hero);
  if (isLocal(seat)) {
    SetCameraTargetController(seat.hero, 0, 0, false);
    applyCamera(seat, heroX, heroY);
  }
  const keys = seat.heroInfo.skills.map((skill, index) => skill.targeting === "passive" ? `${skill.name} (passive)` : `${SKILL_KEYS[index]} ${skill.name}`).join(", ");
  say(seat, `WASD moves the ${seat.heroInfo.name}, hold the right mouse button and drag to turn the camera, left click or Space swings, hold Q to guard (early: parry), Tab targets, F sends the squad at it, 1 Vanguard, 2 Tight Guard. Skills: ${keys}; click the spell bar too, + or L learns. 6 to 0 and - switch cameras. E talks to whoever is near or picks up an item, I opens your inventory. Your party is empty: press E by the quartermaster nearby to recruit soldiers, and by the sergeant at a tavern to talk (Space skips a line, 1 to 4 choose, Esc leaves). Hold outposts for gold.`);
}

// Outposts: capture every second, income every five.

/** Registers a pre-placed or created unit as a capturable outpost; it starts with its current owner. */
export function registerOutpost(outpost: unit): void {
  const { outposts } = state();
  if (!outposts.includes(outpost)) outposts.push(outpost);
}

/**
 * Registers every outpost-type unit the base map placed. Without any, a melee
 * map's gold mines become the outposts: one beside each mine that is no
 * player's home mine, guarded by the map's own creeps. A map with neither gets
 * three outposts around the center, each guarded by gnolls.
 */
function registerOutposts(centerX: number, centerY: number): void {
  const rps = state();
  GroupEnumUnitsInRect(rps.group, bj_mapInitialPlayableArea, rps.everything);
  const size = BlzGroupGetSize(rps.group);
  const mines: Point[] = [];
  for (let index = 0; index < size; index++) {
    const placed = BlzGroupUnitAt(rps.group, index);
    const type = GetUnitTypeId(placed);
    if (type === OUTPOST) registerOutpost(placed);
    else if (type === GOLD_MINE) mines.push(pointOf(placed));
  }
  if (rps.outposts.length > 0) return;
  const center = { x: Math.floor(centerX), y: Math.floor(centerY) };
  const starts = rps.picks.map((pick) => startOf(pick.id));
  for (const mine of mines) {
    if (isHomeMine(mine, starts)) continue;
    const at = outpostBeside(mine, center);
    registerOutpost(CreateUnit(Player(PLAYER_NEUTRAL_PASSIVE), OUTPOST, at.x, at.y, 270.0));
  }
  if (rps.outposts.length > 0) return;
  for (const [dx, dy] of [[0, 1200], [-1400, -900], [1400, -900]] as const) {
    const x = centerX + dx, y = centerY + dy;
    registerOutpost(CreateUnit(Player(PLAYER_NEUTRAL_PASSIVE), OUTPOST, x, y, 270.0));
    CREEPS.forEach((type, index) => CreateUnit(Player(PLAYER_NEUTRAL_AGGRESSIVE), type, x + 120 * (index - 1), y + 160, 270.0));
  }
}

function captureTick(): void {
  const rps = state();
  for (const outpost of rps.outposts) {
    const owner = GetPlayerId(GetOwningPlayer(outpost));
    const present: number[] = [];
    for (const other of unitsInRange(GetUnitX(outpost), GetUnitY(outpost), CAPTURE_RADIUS)) {
      if (rps.outposts.includes(other) || !alive(other)) continue;
      const id = GetPlayerId(GetOwningPlayer(other));
      if (!present.includes(id)) present.push(id);
    }
    const next = captureOwner(
      owner, present,
      (id) => rps.seats.some((seat) => seat.id === id),
      (a, b) => IsPlayerEnemy(Player(a), Player(b)),
    );
    if (next === owner) continue;
    SetUnitOwner(outpost, Player(next), true);
    sayAll(`${GetPlayerName(Player(next))} captured an outpost.`);
  }
}

function incomeTick(): void {
  const rps = state();
  for (const seat of rps.seats) {
    const owned = rps.outposts.filter((outpost) => GetPlayerId(GetOwningPlayer(outpost)) === seat.id).length;
    if (owned === 0) continue;
    SetPlayerState(seat.player, PLAYER_STATE_RESOURCE_GOLD, GetPlayerState(seat.player, PLAYER_STATE_RESOURCE_GOLD) + income(owned));
  }
}

export function install(this: void): void {
  configureRuntime({ filePrefix: "rps", readyPrefix: "RPS_HRR", globalPrefix: "__rps" });
  installDispatch();
  installScenes({
    state: () => state(),
    now: () => now(),
    switchedOff: (feature) => off(feature),
    standDown: (scene) => {
      const seat = seatFor(scene);
      lowerGuard(seat);
      seat.killCam = undefined;
      seat.fight.swing = undefined;
      seat.fight.buffered = undefined;
      seat.fight.pending = undefined;
      seat.keys.w = false;
      seat.keys.a = false;
      seat.keys.s = false;
      seat.keys.d = false;
      IssueImmediateOrder(seat.hero, "stop");
    },
    sidekick: (scene) => {
      const seat = seatFor(scene);
      const member = seat.squad.find((candidate) => alive(candidate.unit));
      return member === undefined ? undefined : { unit: member.unit, code: seat.race.army.find((soldier) => soldier.role === member.role)?.code };
    },
    lineValues: (scene) => lineValues(seatFor(scene)),
    recruit: (scene, role, cost) => recruit(seatFor(scene), role, cost),
    join: (scene, code, count, role) => {
      const seat = seatFor(scene);
      const hero = pointOf(seat.hero);
      for (let index = 0; index < count; index++) {
        const spot = offset(hero.x, hero.y, seat.yaw.current + 1800, 140, (index * 2 - count + 1) * 80);
        seat.squad.push({ unit: CreateUnit(seat.player, rawcode(code), spot.x, spot.y, seat.yaw.current / 10), role });
      }
    },
    sceneShown: (scene, shown) => {
      const seat = seatFor(scene);
      if (shown) {
        showMinimap(minimapShown());
        if (isLocal(seat) && seat.hud !== undefined) BlzFrameSetVisible(seat.hud.root, false);
      } else {
        if (isLocal(seat) && seat.hud !== undefined) BlzFrameSetVisible(seat.hud.root, true);
        // Warcraft's interface comes back as it was: everything goes where the map keeps it again.
        arrangeInterface();
      }
    },
  });
  on("rps.camera", cameraTick);
  on("rps.occlusion", occlusionTick);
  on("rps.stance", stanceTick);
  on("rps.capture", captureTick);
  on("rps.income", incomeTick);
  on("rps.damage", damaged);
  on("rps.death", died);
  on("rps.keyDown", () => key(true));
  on("rps.keyUp", () => key(false));
  on("rps.arrange", arrangeInterface);
  on("rps.level", leveled);
  on("rps.hud", hudTick);
  on("rps.click", hudClick);
  on("rps.mouseDown", () => mouse(true));
  on("rps.mouseUp", () => mouse(false));
  on("rps.animation", animationCommand);
  on("rps.pickTimeout", pickTimeout);
  on("rps.scene", sceneCommand);
  on("rps.time", timeCommand);
  on("rps.switch", switchCommand);
  on("rps.yaw", yawSynced);
  on("rps.voice", voiceSynced);
  installHotReload();
}

/** Moves one of Warcraft's frames to a layout box. */
function place(frame: framehandle, box: Box): void {
  BlzFrameClearAllPoints(frame);
  BlzFrameSetAbsPoint(frame, FRAMEPOINT_BOTTOMLEFT, ui(box.left), ui(box.bottom));
  BlzFrameSetSize(frame, ui(box.width), ui(box.height));
}

/** Hides one of Warcraft's frames by name, when this build of the game has it. */
function hideNamed(name: string): void {
  const frame: framehandle | undefined = BlzGetFrameByName(name, 0);
  if (frame !== undefined) BlzFrameSetVisible(frame, false);
}

/** Moves a frame below the screen: hiding Warcraft's own parts by name didn't keep them hidden (the Inventory label came back). */
function moveAway(frame: framehandle | undefined): void {
  if (frame !== undefined) place(frame, OFF_SCREEN_BOX);
}

/** Warcraft's console parts found by name: the stone bars, the unit info, the Inventory label and the top bar's menu buttons, resources and clock. */

const CONSOLE_PARTS = [
  "ConsoleBottomBar", "ConsoleBottomBarOverlay", "ConsoleTopBar", "ConsoleTopBarOverlay",
  "SimpleInfoPanelUnitDetail", "InventoryText", "UpperButtonBarFrame", "ResourceBarFrame",
];

/**
 * Warcraft's classic interface, all of it below the screen: the world draws
 * under the whole screen, the console's black backdrop is hidden, and the
 * stone bars, the unit info, the inventory, the command card, the portrait,
 * the minimap with its buttons, the hero icon and the top bar (menu buttons,
 * resources, clock) move below the screen. Moving a part works
 * where hiding it didn't: Warcraft shows parts again as the selection
 * changes, and hiding the stone bar hid the portrait's neighbours with it.
 * Warcraft stops placing its frames itself first, so it doesn't move them
 * back. F10 still opens the menu and F12 the log. Every client makes the
 * same calls; each changes only its own player's screen.
 */
function arrangeInterface(): void {
  BlzEnableUIAutoPosition(false);
  BlzFrameSetAllPoints(BlzGetOriginFrame(ORIGIN_FRAME_WORLD_FRAME, 0), BlzGetOriginFrame(ORIGIN_FRAME_GAME_UI, 0));
  hideNamed("ConsoleUIBackdrop");
  for (const name of CONSOLE_PARTS) moveAway(BlzGetFrameByName(name, 0));
  showMinimap(minimapShown());
  for (let index = 0; index < 5; index++) moveAway(BlzGetOriginFrame(ORIGIN_FRAME_MINIMAP_BUTTON, index));
  moveAway(BlzGetOriginFrame(ORIGIN_FRAME_HERO_BAR, 0));
  moveAway(BlzGetOriginFrame(ORIGIN_FRAME_PORTRAIT_HP_TEXT, 0));
  moveAway(BlzGetOriginFrame(ORIGIN_FRAME_PORTRAIT_MANA_TEXT, 0));
  for (let index = 0; index < 12; index++) moveAway(BlzGetOriginFrame(ORIGIN_FRAME_COMMAND_BUTTON, index));
  for (let index = 0; index < 6; index++) moveAway(BlzGetOriginFrame(ORIGIN_FRAME_ITEM_BUTTON, index));
  moveAway(BlzGetOriginFrame(ORIGIN_FRAME_PORTRAIT, 0));
}

/** Whether this client's player is out of any scene, so his minimap shows. */
function minimapShown(): boolean {
  return !state().seats.some((seat) => isLocal(seat) && seat.scene !== undefined);
}

/**
 * Puts the minimap in the top-right corner of the 4:3 frame space (Warcraft
 * draws it only there: placed past 0.8 on a wide window it didn't show),
 * hidden while a scene's letterbox is up (moved below the screen and back, it
 * didn't come back). Every client makes the
 * same calls, each placing its own player's minimap.
 */
function showMinimap(shown: boolean): void {
  const minimap = BlzGetOriginFrame(ORIGIN_FRAME_MINIMAP, 0);
  place(minimap, MINIMAP);
  BlzFrameSetVisible(minimap, shown);
}

/** A player's start location from the map, in whole units. */
function startOf(id: number): Point {
  const start = GetPlayerStartLocation(Player(id));
  return { x: Math.floor(GetStartLocationX(start)), y: Math.floor(GetStartLocationY(start)) };
}

function spawnSeat(id: number, x: number, y: number, race: Race, heroInfo: Hero): Seat {
  const player = Player(id);
  SetPlayerState(player, PLAYER_STATE_RESOURCE_FOOD_CAP, FOOD_CAP);
  SetPlayerState(player, PLAYER_STATE_FOOD_CAP_CEILING, FOOD_CAP);
  const hero = CreateUnit(player, rawcode(heroInfo.code), x, y, 90.0);
  // A melee hero swings only when the player does: no attack ability, so no auto-attack.
  // A ranged hero keeps Warcraft's own attack (`rangedAttack`).
  if (heroInfo.ranged !== true) UnitRemoveAbility(hero, ATTACK_ABILITY);
  // The party starts empty: soldiers are recruited from the quartermaster, with the starting gold.
  const squad: Member[] = [];
  SetPlayerState(player, PLAYER_STATE_RESOURCE_GOLD, STARTING_GOLD);
  return {
    id, player, hero, race, heroInfo, squad, keys: { w: false, a: false, s: false, d: false },
    fight: { swing: undefined, step: 0, recoverTick: 0, guardTick: undefined, poseTick: undefined, frozen: [], thawTick: 0, speed: Math.floor(GetUnitDefaultMoveSpeed(hero)), pending: undefined, barTick: -100, buffered: undefined, impactTicks: IMPACT_TICKS, guardPose: undefined, guardEffect: undefined, staggerUntil: 0 },
    yaw: { current: START_YAW, target: START_YAW },
    combatMs: 0, stance: "vanguard", target: undefined, hidden: [], shakeMs: 0, camera: DEFAULT_CAMERA, hud: undefined, letterbox: undefined, scene: undefined, talkedTo: undefined,
  };
}

export function start(this: void): void {
  install();
  const centerX = GetRectCenterX(bj_mapInitialPlayableArea);
  const centerY = GetRectCenterY(bj_mapInitialPlayableArea);
  const everything = Filter(() => true);
  globalThis.__rpsState = {
    ticks: 0, seats: [], outposts: [], group: CreateGroup(), rect: Rect(0, 0, 0, 0), location: Location(0, 0), everything, clicks: CreateTrigger(), picks: [], npcs: [], center: { x: Math.floor(centerX), y: Math.floor(centerY) }, drag: { lastX: undefined, yaw: undefined, sent: undefined },
  };
  const rps = state();
  const pressed = CreateTrigger();
  const released = CreateTrigger();
  for (let id = 0; id < SEATS; id++) {
    const player = Player(id);
    if (GetPlayerSlotState(player) !== PLAYER_SLOT_STATE_PLAYING || GetPlayerController(player) !== MAP_CONTROL_USER) continue;
    rps.picks.push({ id, player, race: gameRace(player), list: undefined, done: false, menu: createPicker(id, rps.clicks) });
    for (const code of KEY_CODES) {
      BlzTriggerRegisterPlayerKeyEvent(pressed, player, ConvertOsKeyType(code), 0, true);
      BlzTriggerRegisterPlayerKeyEvent(released, player, ConvertOsKeyType(code), 0, false);
    }
  }
  TriggerAddAction(pressed, trampoline("rps.keyDown"));
  TriggerAddAction(released, trampoline("rps.keyUp"));
  const damage = CreateTrigger();
  for (let id = 0; id < bj_MAX_PLAYER_SLOTS; id++) TriggerRegisterPlayerUnitEvent(damage, Player(id), EVENT_PLAYER_UNIT_DAMAGED, everything);
  TriggerAddAction(damage, trampoline("rps.damage"));
  const deaths = CreateTrigger();
  for (let id = 0; id < bj_MAX_PLAYER_SLOTS; id++) TriggerRegisterPlayerUnitEvent(deaths, Player(id), EVENT_PLAYER_UNIT_DEATH, everything);
  TriggerAddAction(deaths, trampoline("rps.death"));
  registerOutposts(centerX, centerY);
  placeNpcs(centerX, centerY);
  placeWanderers({ x: Math.floor(centerX), y: Math.floor(centerY) });
  placeQuestSites({ x: Math.floor(centerX), y: Math.floor(centerY) });
  // Warcraft's interface parts aren't all in place when the map starts: a
  // published map that rearranges them waits a second, and parts moved at
  // once (the unit info, the portrait's numbers) never showed here.
  TimerStart(CreateTimer(), ARRANGE_DELAY, false, trampoline("rps.arrange"));
  const levels = CreateTrigger();
  for (const pick of rps.picks) TriggerRegisterPlayerUnitEvent(levels, pick.player, EVENT_PLAYER_HERO_LEVEL, everything);
  TriggerAddAction(levels, trampoline("rps.level"));
  TriggerAddAction(rps.clicks, trampoline("rps.click"));
  const mouseDown = CreateTrigger(), mouseUp = CreateTrigger(), animations = CreateTrigger(), scenes = CreateTrigger(), times = CreateTrigger(), switches = CreateTrigger();
  for (const { player } of rps.picks) {
    TriggerRegisterPlayerEvent(mouseDown, player, EVENT_PLAYER_MOUSE_DOWN);
    TriggerRegisterPlayerEvent(mouseUp, player, EVENT_PLAYER_MOUSE_UP);
    TriggerRegisterPlayerChatEvent(animations, player, "-anim", false);
    TriggerRegisterPlayerChatEvent(animations, player, "-combo", false);
    TriggerRegisterPlayerChatEvent(animations, player, "-impact", false);
    TriggerRegisterPlayerChatEvent(animations, player, "-guard", false);
    TriggerRegisterPlayerChatEvent(scenes, player, "-scene", true);
    TriggerRegisterPlayerChatEvent(times, player, "-time", false);
    TriggerRegisterPlayerChatEvent(switches, player, "-off", false);
    TriggerRegisterPlayerChatEvent(switches, player, "-on", false);
  }
  TriggerAddAction(scenes, trampoline("rps.scene"));
  TriggerAddAction(times, trampoline("rps.time"));
  TriggerAddAction(switches, trampoline("rps.switch"));
  const yaws = CreateTrigger();
  for (const { player } of rps.picks) BlzTriggerRegisterPlayerSyncEvent(yaws, player, YAW_PREFIX, false);
  TriggerAddAction(yaws, trampoline("rps.yaw"));
  const voices = CreateTrigger();
  for (const { player } of rps.picks) BlzTriggerRegisterPlayerSyncEvent(voices, player, VOICE_PREFIX, false);
  TriggerAddAction(voices, trampoline("rps.voice"));
  TriggerAddAction(mouseDown, trampoline("rps.mouseDown"));
  TriggerAddAction(mouseUp, trampoline("rps.mouseUp"));
  TriggerAddAction(animations, trampoline("rps.animation"));
  // Each player first picks a race and a hero; the camera waits over their start location.
  for (const pick of rps.picks) {
    showPick(pick);
    const isMine = GetPlayerId(GetLocalPlayer()) === pick.id;
    BlzFrameSetVisible(pick.menu.root, isMine);
    const start = startOf(pick.id);
    if (isMine) SetCameraPosition(start.x, start.y);
  }
  TimerStart(CreateTimer(), PICK_SECONDS, false, trampoline("rps.pickTimeout"));
  // Nothing is ever selected, so no command card and no Warcraft hotkey: the
  // player steers the hero with the map's keys and the spell bar.
  EnableSelect(false, false);
  EnableDragSelect(false, false);
  ClearSelection();
  TimerStart(CreateTimer(), CAMERA_PERIOD, true, trampoline("rps.camera"));
  TimerStart(CreateTimer(), OCCLUSION_PERIOD, true, trampoline("rps.occlusion"));
  TimerStart(CreateTimer(), HUD_PERIOD, true, trampoline("rps.hud"));
  TimerStart(CreateTimer(), STANCE_PERIOD, true, trampoline("rps.stance"));
  TimerStart(CreateTimer(), CAPTURE_PERIOD, true, trampoline("rps.capture"));
  TimerStart(CreateTimer(), INCOME_PERIOD, true, trampoline("rps.income"));
  sayAll(`Choose your race and hero: click, or press 1 to 4 (0 goes back). ${PICK_SECONDS} seconds.`);
  startHotReload();
}

