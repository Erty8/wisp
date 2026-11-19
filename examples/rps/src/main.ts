// The role-playing strategy (RPS) map's entry, a 1999-style prototype: each
// player has one hero and a small retinue, a damped third-person camera that
// swings in behind the hero as he runs, WASD movement relative to the camera,
// Tab soft-targeting, manual attacks and a guard (./combat.ts), a spell bar,
// squad stances and capturable income outposts. Each player first picks a
// race and a hero (./picker.ts, ./roster.ts); the hero spawns alone on the
// player's start location and recruits his race's soldiers from the
// quartermaster beside it, in a dialogue. Walking up to an NPC plays a personal
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
import { type Hud, type SlotView, createHud, hudAction, showHud } from "./hud";
import { activeQuests, journalText } from "./journal";
import { type Picker, createPicker, pickerAction, showPicker } from "./picker";
import { type Letterbox, choiceOf, createLetterbox, setFade, showChoices, showSubtitle } from "./letterbox";
import {
  type Actor, type Bounty, type DialogueNode, type Effect, type Framing, type LastShot, type Mood, type Scene,
  BARK_RANGE, BARK_RESET_RANGE, FACE_HEIGHT, FADE_TICKS, RECRUIT_SCENE, SCENE_PAUSE_RANGE, STARTING_GOLD, TALK_ANIMATION, TALK_RANGE, TALK_RESET_RANGE, TAVERN_SCENE, WANDERERS, choiceStates, countTakes, directShot, objectiveSpot, fadeAlpha, fillLine, framing, gestureOf, hasNews, lineTicks, listenerOf, meets, openingOf, recordingFile, recruitOutcome, sceneFraming, seenFlag, shotFace, talkSpot, talkTicks, voiceFile, voiceTicks,
} from "./dialogue";
import { QUEST_SITES } from "./quests";
import { faceHeight, gestureFor, talkAnimation, voiceCandidates } from "./units";
import { KILL_CAM_RANGE, KILL_CAM_TICKS, SLOW_MOTION_RADIUS, SLOW_MOTION_SCALE, endsFight, killCamShot } from "./killcam";
import { type Hero, type Race, type Skill, DEFAULT_PICK, PICK_SECONDS, RACES, disabledIcon, heroOf, icon, raceOf, rawcode } from "./roster";
import {
  AUTO_TARGET_RANGE, BLOCK_MANA, CLICK_SETTLE_TICKS, FINISHER_KNOCKBACK, SHOT_RADIUS, SHOT_RANGE, SHOT_SPEED, GUARD_POSE_TICKS, GUARD_SPEED_DENOMINATOR, GUARD_SPEED_NUMERATOR, HIT_STOP_TICKS, IMPACT_TICKS,
  PARRY_COUNTER_DAMAGE, PARRY_KNOCKBACK, RECOIL_TICKS, STAGGER_TICKS, SWING_HALF_ANGLE, SWING_RANGE, bufferable, canAct, stepIn, swingTicks,
  atan2Tenths, attackFacing, autoTarget, ringCorner, ringSize, blockedDamage, guardOutcome, inCone, isSpellBarClick, nextComboStep, shotHit, swingDamage,
} from "./combat";
import {
  type Candidate, type Point, type Role, type SkillRanks, type Stance, type Yaw,
  CAMERA_PERIOD_MS, CAPTURE_RADIUS, DEFAULT_CAMERA, SHAKE_MS, SHAKE_RANGE, FAR_Z, FOOD_CAP, OCCLUSION_RADIUS, START_YAW, TARGET_RANGE, CAMERA_PRESETS, type CameraPreset, describeCamera,
  cameraZOffset, captureOwner, combatAfter, distanceSquared, eyePoint, fourCC, isHomeMine, outpostBeside, guardSlot, income, movePoint, needsRegroup, nextTarget,
  canLearn, dragYaw, nextSkill, occludes, offset, percentOf, rankText, vanguardSlot,
} from "./rules";
import {
  SEATS, CAMERA_PERIOD, OCCLUSION_PERIOD, STANCE_PERIOD, ARRANGE_DELAY, HUD_PERIOD, CAPTURE_PERIOD, INCOME_PERIOD, MOVE_EVERY_TICKS, DEAD_LIFE, SKILL_KEYS, SHAKE_MAGNITUDE, SHAKE_VELOCITY, SWING_SPEED, COUNTER_SPEED, SLASH_MODEL, PARRY_MODEL, BLOCK_MODEL, GUARD_MODEL, GUARD_WALK_SPEED, RECOIL_SPEED, FLOAT_TEXT_SIZE, FLOAT_TEXT_RISE, ATTACK_ABILITY, OUTPOST, ORDER_MOVE, ORDER_SMART, YAW_PREFIX, TAVERN, TURN_SECONDS, GOLD_MINE, CREEPS, ui, RING_TEXTURE, IMAGE_TYPE_SELECTION, TARGET_TINT, NEWS_MODEL, QUEST_ICON_SKIN_KEY, QUEST_ICON_FILE, VOICE_PREFIX, FIGHT_DISTANCE, SITE_RADIUS, CAMP_DISTANCE, CAMP_RADIUS, OBJECTIVE_RADIUS, OBJECTIVE_ICON_SKIN_KEY, OBJECTIVE_ICON_FILE, OBJECTIVE_PING_SECONDS, BARK_TEXT_SIZE, KEY, KEY_CODES, SKILL_KEY_CODES, PICK_KEYS, CAMERA_KEYS,
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

/** A ranged hero's shot in flight: its missile, where it is, its heading (tenths of a degree), how far it has flown and its damage. */
interface Shot {
  readonly effect: effect;
  x: number;
  y: number;
  readonly facing: number;
  travelled: number;
  readonly damage: number;
}

/** A shot's missile flies this high above the ground it was fired from. */
const SHOT_HEIGHT = 60.0;

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
  /** A ranged hero's shots in flight. */
  shots: Shot[];
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

interface Seat {
  readonly id: number;
  readonly player: player;
  readonly hero: unit;
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
  /** The player's scene letterbox, and the scene playing for them, if any. */
  letterbox: Letterbox | undefined;
  scene: SceneRun | undefined;
  /** The NPC the hero last talked to: it starts its scene again only once he has walked away. */
  talkedTo: unit | undefined;
  /** Whether the hero is rooted (`rootTick`). */
  rooted?: boolean | undefined;
  /** What the player's scenes remember he did. */
  flags?: Set<string> | undefined;
  /** NPCs that have called out to the hero, until he has gone BARK_RESET_RANGE away. */
  barked?: unit[] | undefined;
  /** The "!" over each NPC with something new for this player, and his quest icon on the minimap. */
  news?: Map<unit, { readonly mark: effect; readonly icon: minimapicon }> | undefined;
  /** The player's screen fading to or from black: the tick it began. */
  fade?: { readonly start: number; readonly toBlack: boolean } | undefined;
  /** The kill cam on the last enemy of a fight: where it fell and the tick the shot began, while it plays. */
  killCam?: { readonly fallen: Point; readonly start: number } | undefined;
}

/** Match state lives in a global, so a reloaded bundle continues it. */
interface RpsState {
  ticks: number;
  readonly seats: Seat[];
  readonly outposts: unit[];
  /** One group, rect and location reused by every query, so nothing leaks. */
  readonly group: group;
  readonly rect: rect;
  readonly location: location;
  readonly everything: filterfunc;
  /** Fires on every spell bar click. */
  readonly clicks: trigger;
  /** Animation indices -combo set for the three swings, in place of the attack animations by name. */
  comboAnimations?: readonly number[] | undefined;
  /** Every player's race and hero pick, until they have picked. */
  readonly picks: Pick[];
  /** The NPCs heroes can talk to. */
  readonly npcs: Npc[];
  /** The playable area's center. */
  readonly center: Point;
  /**
   * This client's own right-mouse drag: the pointer's last X, the yaw dragged
   * to and the last yaw sent. Local to each client, it only ever turns the
   * local camera and is sent to the others by sync.
   */
  readonly drag: { lastX: number | undefined; yaw: number | undefined; sent: number | undefined };
  /** Parts of the map `-off` has switched off. */
  off?: Set<string> | undefined;
  /** Each unit type's voice prefix as found (`voicePrefixOf`), "" for none. */
  voices?: Map<string, string> | undefined;
  /** How many recordings of a mood's kind each unit type's set has, by "code:mood", as measured (`takesOf`). */
  takes?: Map<string, number> | undefined;
  /** Units a scene raised or turned, by "seat:tag"; the bounties waiting on them; and turned units still dazed, until a tick. */
  tagged?: Map<string, unit[]> | undefined;
  bounties?: { readonly seat: number; readonly key: string; readonly bounty: Bounty }[] | undefined;
  /** Each quest objective marked on a player's minimap, by "seat:tag", until every unit under the tag has fallen. */
  objectives?: { readonly key: string; readonly icon: minimapicon }[] | undefined;
  held?: { readonly unit: unit; readonly until: number; readonly seat: number }[] | undefined;
  /** NPCs and companies fighting on a hero's side, until the fight under their key is won, and the post they go back to. */
  allies?: { readonly unit: unit; readonly key: string; readonly post: Point }[] | undefined;
  /** While a parry's counter-slash deals its damage, so it isn't parried in turn. */
  countering?: boolean | undefined;
  /** Units in a kill cam's slow motion, each with the speed it would play at without it, and the tick it ends. */
  slowed?: Map<unit, number> | undefined;
  slowUntil?: number | undefined;
}

/** A personal scene playing: the scene, its NPC, the line up, the tick it ends, its voice and the units it paused. */
interface SceneRun {
  readonly scene: Scene;
  readonly npc: unit;
  node: DialogueNode;
  endTick: number;
  voice: sound | undefined;
  readonly paused: unit[];
  /** The NPC's name in the subtitles and the unit type whose voice he speaks with. */
  readonly npcName: string;
  readonly npcCode: string;
  /** The soldier of the hero's squad on stage, if the scene has lines for one, his unit type and name. */
  readonly squad: unit | undefined;
  readonly squadCode: string | undefined;
  readonly squadName: string;
  /** The tick the scene began, and the tick the line began and how long it runs. */
  readonly startTick: number;
  lineStart: number;
  lineLength: number;
  /** Lines played so far, which picks each line's recording. */
  lines: number;
  /** The camera: the framing it glides from (undefined on a cut), the line's own, the last line's speaker and shot, and where the speaker stands. */
  from: Framing | undefined;
  to: Framing | undefined;
  last: LastShot | undefined;
  speakerAt: Point;
  /** The height the line's shot looks at: the speaker's face (`faceHeight`), or between both in a two-shot. */
  face?: number | undefined;
  /** The unit speaking the line, and the tick he stops talking (his voice's end, once measured). */
  speakerUnit?: unit | undefined;
  talkUntil?: number | undefined;
  /** The line's filled-in text and speaker's name. */
  text: string;
  speakerName: string;
  /** The tick the scene began fading out, once it is ending. */
  closing: number | undefined;
  /** Enemies the scene raised, who attack once it ends. */
  readonly fights: unit[];
  /** Units that turn on the hero as the scene ends, under their tag, dazed `hold` seconds first. */
  readonly turns: { readonly unit: unit; readonly tag: string; readonly hold: number }[];
  /** Units that fight on the hero's side as the scene ends, until the fight under their tag is won. */
  readonly allies: { readonly unit: unit; readonly tag: string }[];
}

/** An NPC a hero can talk to, the scene he plays, his name and his unit type. */
interface Npc {
  readonly unit: unit;
  readonly scene: Scene;
  readonly name: string;
  readonly code: string;
  /** The units standing with a quest NPC, who may turn on the hero with him (`hostile`). */
  readonly extras: readonly unit[];
}

/** A player choosing: the race chosen so far, if any, and their picker. */
interface Pick {
  readonly id: number;
  readonly player: player;
  race: number | undefined;
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
 * (`BlzSendSyncData`), where it becomes the yaw WASD and the shots go by. Only
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

/** A player's dragged yaw reaches every client: it is what WASD, shots and the tree check turn by. */
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
 * strike, since the Mountain King has none.
 */
function damaged(): void {
  const victim = GetTriggerUnit();
  const source = GetEventDamageSource();
  const siege = BlzGetEventAttackType() === ATTACK_TYPE_SIEGE;
  const spell = !BlzGetEventIsAttack();
  for (const seat of state().seats) {
    if (victim === seat.hero && seat.fight.guardTick !== undefined) guardHit(seat, source);
    if (victim === seat.hero && !moving(seat) && seat.fight.swing === undefined && seat.scene === undefined) IssueImmediateOrder(seat.hero, "holdposition");
    const ours = (target: unit) => target === seat.hero || seat.squad.some((member) => member.unit === target);
    if (ours(victim) || ours(source)) seat.combatMs = combatAfter(seat.combatMs, 0, true);
    const near = distanceSquared(pointOf(victim), pointOf(seat.hero)) <= SHAKE_RANGE * SHAKE_RANGE;
    if ((siege && near) || (spell && source === seat.hero)) shake(seat);
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
  const closer = seat.heroInfo.missile === undefined ? stepIn(from, target, facing) : undefined;
  if (closer !== undefined) shove(hero, closer);
  timeScale(hero, SWING_SPEED);
  swingAnimation(seat, step);
}

/** The swing's damage lands on every enemy in its cone; hit units and the hero freeze for a moment, and the finisher knocks them back. */
function landSwing(seat: Seat, swing: Swing): void {
  const { hero, fight } = seat;
  swing.landed = true;
  if (seat.heroInfo.missile !== undefined) return fireShot(seat, swing, seat.heroInfo.missile);
  const origin = pointOf(hero);
  const hits: unit[] = [];
  for (const other of unitsInRange(origin.x, origin.y, SWING_RANGE + 50)) {
    if (!alive(other) || !IsUnitEnemy(other, seat.player) || !inCone(origin, swing.facing, pointOf(other), SWING_RANGE, SWING_HALF_ANGLE)) continue;
    hits.push(other);
  }
  if (hits.length === 0) return;
  for (const target of hits) {
    UnitDamageTarget(hero, target, swingDamage(swing.step), true, false, ATTACK_TYPE_HERO, DAMAGE_TYPE_NORMAL, WEAPON_TYPE_METAL_HEAVY_SLICE);
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

/** A ranged hero's swing fires his missile along the aim, from his position, as an effect the camera tick moves. */
function fireShot(seat: Seat, swing: Swing, missile: string): void {
  const from = pointOf(seat.hero);
  const effect = AddSpecialEffect(missile, from.x, from.y);
  BlzSetSpecialEffectHeight(effect, SHOT_HEIGHT);
  BlzSetSpecialEffectYaw(effect, swing.facing * Math.PI / 1800);
  seat.fight.shots.push({ effect, x: from.x, y: from.y, facing: swing.facing, travelled: 0, damage: swingDamage(swing.step) });
}

/**
 * Every camera tick each shot flies SHOT_SPEED further; it hits the nearest
 * enemy within SHOT_RADIUS of where it lands (damage, and its missile's death
 * as the impact), or fades once it has flown SHOT_RANGE.
 */
function moveShots(seat: Seat): void {
  const { fight, hero } = seat;
  const flying: Shot[] = [];
  for (const shot of fight.shots) {
    const next = offset(shot.x, shot.y, shot.facing, SHOT_SPEED, 0);
    shot.x = next.x;
    shot.y = next.y;
    shot.travelled += SHOT_SPEED;
    BlzSetSpecialEffectX(shot.effect, next.x);
    BlzSetSpecialEffectY(shot.effect, next.y);
    const enemies = unitsInRange(next.x, next.y, SHOT_RADIUS + 40).filter((other) => alive(other) && IsUnitEnemy(other, seat.player));
    const hit = shotHit(next, enemies.map((other) => pointOf(other)));
    const victim = hit === undefined ? undefined : enemies[hit];
    if (victim !== undefined) {
      UnitDamageTarget(hero, victim, shot.damage, true, true, ATTACK_TYPE_HERO, DAMAGE_TYPE_NORMAL, WEAPON_TYPE_WHOKNOWS);
      seat.combatMs = combatAfter(seat.combatMs, 0, true);
      DestroyEffect(shot.effect);
    } else if (shot.travelled >= SHOT_RANGE) DestroyEffect(shot.effect);
    else flying.push(shot);
  }
  fight.shots = flying;
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
    UnitDamageTarget(hero, attacker, PARRY_COUNTER_DAMAGE, true, false, ATTACK_TYPE_HERO, DAMAGE_TYPE_NORMAL, WEAPON_TYPE_METAL_HEAVY_SLICE);
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
  if (fight.shots.length > 0) moveShots(seat);
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
    });
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
  if (action.kind === "learn") learn(seat, action.slot);
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
  else if (code === KEY.f) attackTarget(seat);
  else if (code === KEY.one) setStance(seat, "vanguard");
  else if (code === KEY.two) setStance(seat, "guard");
  else if (SKILL_KEY_CODES.includes(code)) castSkill(seat, SKILL_KEY_CODES.indexOf(code));
  else if (code === KEY.l) learnNext(seat);
  else if (code === KEY.space) startSwing(seat, undefined);
  else if (CAMERA_KEYS.includes(code)) setCamera(seat, CAMERA_KEYS.indexOf(code));
}

// Personal scenes: a hero who walks up to an NPC plays its scene, for his
// player alone. Units around pause, the hero can't be hurt, the scene fades
// in from black as its bars slide in, the director cuts and glides between
// procedural shots, the actors look each other in the eye and gesture, and
// the NPC, the hero and a soldier of his squad speak in their own voices.

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

/** The player's flags: what his scenes remember he did. */
function flagsOf(seat: Seat): Set<string> {
  const flags = seat.flags ?? new Set<string>();
  seat.flags = flags;
  return flags;
}

function goldOf(seat: Seat): number {
  return GetPlayerState(seat.player, PLAYER_STATE_RESOURCE_GOLD);
}

/**
 * Every 0.5 s: a hero within TALK_RANGE of an NPC starts its scene, unless he
 * talked to it last and hasn't walked away yet; one within BARK_RANGE hears
 * it call out; the "!" over NPCs with something new for him is kept up.
 */
function talkCheck(seat: Seat): void {
  const hero = pointOf(seat.hero);
  if (seat.talkedTo !== undefined && distanceSquared(hero, pointOf(seat.talkedTo)) > TALK_RESET_RANGE * TALK_RESET_RANGE) seat.talkedTo = undefined;
  markNews(seat);
  if (!alive(seat.hero)) return;
  barkCheck(seat, hero);
  for (const npc of state().npcs) {
    if (!talkable(npc) || npc.unit === seat.talkedTo || inScene(npc.unit)) continue;
    if (distanceSquared(hero, pointOf(npc.unit)) <= TALK_RANGE * TALK_RANGE) return startScene(seat, npc);
  }
}

/** Whether an NPC can still be talked to: alive, and not turned on anyone. */
const talkable = (npc: Npc) => alive(npc.unit) && GetPlayerId(GetOwningPlayer(npc.unit)) === PLAYER_NEUTRAL_PASSIVE;

/** Whether an NPC is in someone's scene. */
function inScene(npc: unit): boolean {
  return state().seats.some((seat) => seat.scene?.npc === npc);
}

/**
 * Ambient barks: an NPC with a bark turns to a hero walking past within
 * BARK_RANGE (but not yet close enough to talk) and calls out once, a voiced
 * line over his head for that player alone, until the hero has gone
 * BARK_RESET_RANGE away. The game doesn't stop.
 */
function barkCheck(seat: Seat, hero: Point): void {
  const barked = (seat.barked ?? []).filter((npc) => distanceSquared(hero, pointOf(npc)) <= BARK_RESET_RANGE * BARK_RESET_RANGE);
  seat.barked = barked;
  for (const npc of state().npcs) {
    const bark = npc.scene.bark;
    if (bark === undefined || !talkable(npc) || barked.includes(npc.unit) || npc.unit === seat.talkedTo || inScene(npc.unit)) continue;
    const at = pointOf(npc.unit);
    const distance = distanceSquared(hero, at);
    if (distance > BARK_RANGE * BARK_RANGE || distance <= TALK_RANGE * TALK_RANGE) continue;
    barked.push(npc.unit);
    SetUnitFacingTimed(npc.unit, atan2Tenths(hero.y - at.y, hero.x - at.x) / 10, TURN_SECONDS);
    const gesture = gestureFor(npc.code, bark.mood);
    if (gesture !== undefined) {
      SetUnitAnimation(npc.unit, gesture);
      QueueUnitAnimation(npc.unit, "stand");
    }
    speak(seat, npc.code, bark.mood, floorMod(state().ticks, 4), undefined);
    const tag = CreateTextTag();
    SetTextTagText(tag, `${npc.name}: ${fillLine(bark.text, lineValues(seat))}`, BARK_TEXT_SIZE);
    SetTextTagPosUnit(tag, npc.unit, 40);
    SetTextTagColor(tag, 255, 220, 120, 255);
    SetTextTagPermanent(tag, false);
    SetTextTagLifespan(tag, 3.0);
    SetTextTagFadepoint(tag, 2.0);
    SetTextTagVisibility(tag, false);
    if (isLocal(seat)) SetTextTagVisibility(tag, true);
  }
}

/** The "!" over each NPC whose scene has something new for this player (`hasNews`), shown to him alone. */
function markNews(seat: Seat): void {
  const marks = seat.news ?? new Map<unit, { readonly mark: effect; readonly icon: minimapicon }>();
  seat.news = marks;
  const flags = flagsOf(seat);
  for (const npc of state().npcs) {
    const marked = marks.get(npc.unit);
    const news = !off("marks") && hasNews(npc.scene, flags) && talkable(npc);
    if (news && marked === undefined) {
      // Every client makes the same mark and minimap icon; every player but this one sees through them.
      const mark = AddSpecialEffectTarget(NEWS_MODEL, npc.unit, "overhead");
      const icon = CreateMinimapIconOnUnit(npc.unit, 255, 220, 0, questIconPath(), FOG_OF_WAR_MASKED);
      SetMinimapIconVisible(icon, false);
      if (isLocal(seat)) SetMinimapIconVisible(icon, true);
      else BlzSetSpecialEffectAlpha(mark, 0);
      marks.set(npc.unit, { mark, icon });
    } else if (!news && marked !== undefined) {
      DestroyEffect(marked.mark);
      DestroyMinimapIcon(marked.icon);
      marks.delete(npc.unit);
    }
  }
}

/** Warcraft's quest giver icon for the minimap, from the game's own interface skin, or its file if the skin has no such key. */
function questIconPath(): string {
  const path = SkinManagerGetLocalPath(QUEST_ICON_SKIN_KEY);
  return path === "" ? QUEST_ICON_FILE : path;
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
  if (seat === undefined || seat.scene !== undefined) return;
  const hero = pointOf(seat.hero);
  let nearest: Npc | undefined, best = 0;
  for (const npc of state().npcs) {
    if (!talkable(npc)) continue;
    const distance = distanceSquared(hero, pointOf(npc.unit));
    if (nearest === undefined || distance < best) {
      nearest = npc;
      best = distance;
    }
  }
  if (nearest === undefined) say(seat, "No one to talk to.");
  else startScene(seat, nearest);
}

/** The unit playing an actor in a scene: the hero, the NPC, or the soldier who came along, if any. */
function actorUnit(seat: Seat, run: SceneRun, actor: Actor): unit | undefined {
  if (actor === "hero") return seat.hero;
  if (actor === "npc") return run.npc;
  return run.squad;
}

/**
 * The line to play for a node id: the node, or, while the player doesn't meet
 * its conditions or it needs a soldier the hero hasn't brought, the next one
 * after it; undefined at the end.
 */
function lineAt(seat: Seat, run: SceneRun, id: string | undefined): DialogueNode | undefined {
  const flags = flagsOf(seat), gold = goldOf(seat);
  let next = id;
  for (let guard = 0; guard < 16 && next !== undefined; guard++) {
    const node = run.scene.nodes.find((candidate) => candidate.id === next);
    if (node === undefined) return undefined;
    const castable = actorUnit(seat, run, node.speaker) !== undefined && actorUnit(seat, run, listenerOf(node)) !== undefined;
    if (castable && meets(node.when, flags, gold, seat.heroInfo.code)) return node;
    next = node.next;
  }
  return undefined;
}

/**
 * Starts a personal scene: the hero stops, drops his guard and swing, can't
 * be hurt and steps to TALK_DISTANCE from the NPC; a soldier of his squad,
 * if the scene has lines for one, steps up beside him; units within
 * SCENE_PAUSE_RANGE pause, except other players' (they keep playing) and
 * the actors; the player's HUD gives way to the letterbox, faded in from
 * black. The scene opens where the player's flags say (`openingOf`).
 */
function startScene(seat: Seat, npc: Npc): void {
  const { hero, fight } = seat;
  // The run starts on the scene's first node; lineAt then finds where this player's opening leads.
  const opening = npc.scene.nodes[0];
  if (!alive(hero) || !alive(npc.unit) || opening === undefined) return;
  lowerGuard(seat);
  seat.killCam = undefined;
  fight.swing = undefined;
  fight.buffered = undefined;
  fight.pending = undefined;
  seat.keys.w = false;
  seat.keys.a = false;
  seat.keys.s = false;
  seat.keys.d = false;
  IssueImmediateOrder(hero, "stop");
  SetUnitInvulnerable(hero, true);
  const npcAt = pointOf(npc.unit);
  shove(hero, talkSpot(npcAt, pointOf(hero)));
  const at = pointOf(hero);
  // A soldier who has lines steps up at the hero's shoulder, a little back, on his left.
  const wantsSquad = npc.scene.nodes.some((node) => node.speaker === "squad" || node.to === "squad");
  const member = wantsSquad ? seat.squad.find((candidate) => alive(candidate.unit)) : undefined;
  if (member !== undefined) {
    IssueImmediateOrder(member.unit, "stop");
    shove(member.unit, offset(at.x, at.y, atan2Tenths(npcAt.y - at.y, npcAt.x - at.x), -70, 110));
  }
  const others = state().seats.filter((other) => other !== seat).map((other) => other.player);
  const paused: unit[] = [];
  for (const other of unitsInRange(at.x, at.y, SCENE_PAUSE_RANGE)) {
    if (other === hero || other === npc.unit || other === member?.unit || others.includes(GetOwningPlayer(other))) continue;
    PauseUnit(other, true);
    paused.push(other);
  }
  const squadCode = member === undefined ? undefined : seat.race.army.find((soldier) => soldier.role === member.role)?.code;
  const run: SceneRun = {
    scene: npc.scene, npc: npc.unit, node: opening, endTick: now(), voice: undefined, paused, npcName: npc.name, npcCode: npc.code,
    squad: member?.unit, squadCode, squadName: member === undefined ? "" : GetUnitName(member.unit),
    startTick: now(), lineStart: now(), lineLength: 1, lines: 0, from: undefined, to: undefined, last: undefined, speakerAt: npcAt,
    text: "", speakerName: "", closing: undefined, fights: [], turns: [], allies: [],
  };
  const first = lineAt(seat, run, openingOf(npc.scene, flagsOf(seat), goldOf(seat), seat.heroInfo.code));
  if (first === undefined) {
    for (const unit of paused) PauseUnit(unit, false);
    SetUnitInvulnerable(hero, false);
    return;
  }
  warmVoices(seat, run);
  seat.scene = run;
  showMinimap(minimapShown());
  seat.fade = { start: now(), toBlack: false };
  if (isLocal(seat)) {
    if (seat.hud !== undefined) BlzFrameSetVisible(seat.hud.root, false);
    // No cinematic mode: it took the player's cursor, keys and clicks, which the scene needs.
    if (seat.letterbox !== undefined) BlzFrameSetVisible(seat.letterbox.root, true);
  }
  playLine(seat, run, first);
}

/**
 * Warcraft may drop a sound file's first play while it loads it: every
 * recording a scene's lines may play is played once, silent, as it starts.
 */
function warmVoices(seat: Seat, run: SceneRun): void {
  const warmed = new Set<string>();
  for (const node of run.scene.nodes) {
    const code = actorCode(seat, run, node.speaker);
    if (code === undefined) continue;
    const takes = takesOf(code, node.mood);
    for (let take = 0; take < takes; take++) {
      const file = voiceFile(voicePrefixOf(code), node.mood, take, takes);
      if (file === undefined || warmed.has(file)) continue;
      warmed.add(file);
      const warm = CreateSound(file, false, false, false, 10, 10, "DefaultEAXON");
      SetSoundVolume(warm, 0);
      StartSound(warm);
      KillSoundWhenDone(warm);
    }
  }
}

/**
 * How many recordings of a mood's kind a unit type's set has, measured in the
 * game the first time a scene needs them (`countTakes`: a file that isn't
 * there lasts 0 ms, `GetSoundFileDuration`) and kept. Every client has the
 * same game files and asks the same questions, so every client counts alike.
 * Never less than 1, so a game that can't tell still plays the first take.
 */
function takesOf(code: string, mood: Mood): number {
  const rps = state();
  const takes = rps.takes ?? new Map<string, number>();
  rps.takes = takes;
  const key = `${code}:${mood}`;
  const known = takes.get(key);
  if (known !== undefined) return known;
  const prefix = voicePrefixOf(code);
  const counted = prefix === undefined ? 0 : countTakes((take) => GetSoundFileDuration(recordingFile(prefix, mood, take)) > 0);
  // At least the first: if the game can't tell, the line tries take 1, as before.
  const kept = Math.max(counted, 1);
  takes.set(key, kept);
  return kept;
}

/**
 * A unit type's voice: the first of its profile's file prefixes
 * (`voiceCandidates`) the game has recordings under, asked once and kept. If
 * the game can't tell for any of them, the first is tried as it is.
 */
function voicePrefixOf(code: string): string | undefined {
  const rps = state();
  const voices = rps.voices ?? new Map<string, string>();
  rps.voices = voices;
  const known = voices.get(code);
  if (known !== undefined) return known === "" ? undefined : known;
  const candidates = voiceCandidates(code);
  const found = candidates.find((prefix) => PROBE_MOODS.some((mood) => GetSoundFileDuration(recordingFile(prefix, mood, 1)) > 0)) ?? candidates[0];
  voices.set(code, found ?? "");
  return found;
}

/** One mood of each kind of recording, to find a voice by. */
const PROBE_MOODS: readonly Mood[] = ["neutral", "confirm", "attack", "warcry", "angry"];

/** The unit type an actor speaks with. */
function actorCode(seat: Seat, run: SceneRun, actor: Actor): string | undefined {
  if (actor === "hero") return seat.heroInfo.code;
  if (actor === "npc") return run.npcCode;
  return run.squadCode;
}

/**
 * Speaks a mood's recording for a unit type, heard by this player alone:
 * every client makes the sound; only his plays it at full volume. With a
 * `serial`, his client measures the recording and sends its length to every
 * client (`voiceSynced`), so the line stays up as long as it is spoken.
 */
function speak(seat: Seat, code: string, mood: Mood, variant: number, pitch: number | undefined, serial?: number): sound | undefined {
  const file = voiceFile(voicePrefixOf(code), mood, variant, takesOf(code, mood));
  if (file === undefined) return undefined;
  const voice = CreateSound(file, false, false, false, 10, 10, "DefaultEAXON");
  SetSoundVolume(voice, isLocal(seat) ? 127 : 0);
  if (pitch !== undefined) SetSoundPitch(voice, pitch / 100);
  StartSound(voice);
  KillSoundWhenDone(voice);
  if (serial !== undefined && isLocal(seat)) BlzSendSyncData(VOICE_PREFIX, `${serial}:${GetSoundFileDuration(file)}`);
  return voice;
}

/** A player's measured voice length reaches every client: his line stays up at least that long (`voiceTicks`). */
function voiceSynced(): void {
  const seat = seatOf(GetTriggerPlayer());
  const run = seat?.scene;
  if (run === undefined) return;
  const [serial, ms] = BlzGetTriggerSyncData().split(":");
  if (S2I(serial ?? "") !== run.lineStart || run.closing !== undefined) return;
  const voiceMs = S2I(ms ?? "");
  run.endTick = Math.max(run.endTick, run.lineStart + voiceTicks(voiceMs));
  if (voiceMs > 0) run.talkUntil = run.lineStart + talkTicks(voiceMs);
}

/** A speaker stops talking when his voice ends: back to his stand. */
function talkTick(run: SceneRun): void {
  if (run.speakerUnit === undefined || run.talkUntil === undefined || now() < run.talkUntil) return;
  run.talkUntil = undefined;
  SetUnitAnimation(run.speakerUnit, "stand");
}

/**
 * Plays a line: the speaker and his listener turn to each other; he gestures (the node's
 * animation, else his mood's) and speaks (the next recording of his mood's
 * kind, at the node's pitch); the line's effects happen; the line shows as
 * text, the speaker's name over it, and any choices show; and the director
 * picks the shot, cutting to it for a new speaker and gliding to it for the
 * same one.
 */
function playLine(seat: Seat, run: SceneRun, node: DialogueNode): void {
  stopVoice(run);
  const speaker = actorUnit(seat, run, node.speaker) ?? seat.hero;
  const listener = actorUnit(seat, run, listenerOf(node)) ?? run.npc;
  const from = pointOf(speaker), to = pointOf(listener);
  // The camera glides from wherever the last line's had got to.
  const glideFrom = run.to === undefined ? undefined : sceneFraming(run.from, run.to, now() - run.lineStart, run.lineLength);
  run.node = node;
  run.lineStart = now();
  run.lineLength = lineTicks(node.text);
  run.endTick = run.lineStart + run.lineLength;
  const toListener = atan2Tenths(to.y - from.y, to.x - from.x);
  SetUnitFacingTimed(speaker, toListener / 10, TURN_SECONDS);
  SetUnitFacingTimed(listener, (toListener + 1800) / 10, TURN_SECONDS);
  // The last speaker falls quiet; this one talks, after his gesture if he has one.
  if (run.speakerUnit !== undefined && run.speakerUnit !== speaker && run.talkUntil !== undefined) SetUnitAnimation(run.speakerUnit, "stand");
  const code = actorCode(seat, run, node.speaker);
  const gesture = node.anim ?? (code === undefined ? gestureOf(node.mood) : gestureFor(code, node.mood));
  const talk = code === undefined ? TALK_ANIMATION : talkAnimation(code);
  if (off("talk")) {
    if (gesture !== undefined) {
      SetUnitAnimation(speaker, gesture);
      QueueUnitAnimation(speaker, "stand");
    }
  } else if (gesture !== undefined) {
    SetUnitAnimation(speaker, gesture);
    QueueUnitAnimation(speaker, talk);
  } else SetUnitAnimation(speaker, talk);
  run.speakerUnit = speaker;
  // Until the voice is measured (`voiceSynced`), he talks for the whole line.
  run.talkUntil = run.endTick;
  run.voice = code === undefined ? undefined : speak(seat, code, node.mood, run.lines, node.pitch, run.lineStart);
  run.lines++;
  for (const effect of node.effects ?? []) applyEffect(seat, run, effect);
  const fill = (text: string) => fillLine(text, lineValues(seat));
  run.speakerName = node.speaker === "hero" ? seat.heroInfo.name : node.speaker === "npc" ? run.npcName : run.squadName;
  run.text = fill(node.text);
  // The line as plain text: every client fills every player's, and each sees only his own.
  if (seat.letterbox !== undefined) showSubtitle(seat.letterbox, run.speakerName, run.text);
  const states = choiceStates(node.choices ?? [], flagsOf(seat), goldOf(seat), seat.heroInfo.code);
  if (seat.letterbox !== undefined) {
    showChoices(seat.letterbox, (node.choices ?? []).map((choice, index) => ({ text: fill(choice.text), state: states[index] ?? "open" })));
  }
  const direction = directShot(node, run.last);
  run.last = { speaker: node.speaker, shot: direction.shot };
  run.from = direction.glide ? glideFrom : undefined;
  const listenerCode = actorCode(seat, run, listenerOf(node));
  run.face = shotFace(direction.shot, code === undefined ? FACE_HEIGHT : faceHeight(code), listenerCode === undefined ? FACE_HEIGHT : faceHeight(listenerCode));
  run.to = framing(direction.shot, from, to, Math.floor(BlzGetUnitCollisionSize(listener)), run.face);
  run.speakerAt = from;
}

/** What a line does: gold, a recruit, a flag, soldiers who join, or enemies who attack once the scene ends. */
function applyEffect(seat: Seat, run: SceneRun, effect: Effect): void {
  const hero = pointOf(seat.hero);
  if (effect.kind === "gold") {
    SetPlayerState(seat.player, PLAYER_STATE_RESOURCE_GOLD, Math.max(0, goldOf(seat) + effect.amount));
    say(seat, effect.amount >= 0 ? `${run.npcName} gives you ${effect.amount} gold.` : `You give ${run.npcName} ${-effect.amount} gold.`);
  } else if (effect.kind === "recruit") recruit(seat, effect.role, effect.cost);
  else if (effect.kind === "flag") {
    if (effect.value === false) flagsOf(seat).delete(effect.flag);
    else flagsOf(seat).add(effect.flag);
  } else if (effect.kind === "spawn") {
    for (let index = 0; index < effect.count; index++) {
      const spot = offset(hero.x, hero.y, seat.yaw.current + 1800, 140, (index * 2 - effect.count + 1) * 80);
      seat.squad.push({ unit: CreateUnit(seat.player, rawcode(effect.code), spot.x, spot.y, seat.yaw.current / 10), role: effect.role });
    }
  } else if (effect.kind === "heal") {
    SetWidgetLife(seat.hero, BlzGetUnitMaxHP(seat.hero));
    SetUnitState(seat.hero, UNIT_STATE_MANA, BlzGetUnitMaxMana(seat.hero));
    say(seat, `${run.npcName} heals you.`);
  } else if (effect.kind === "ally") {
    // The NPC himself, or his company of one unit type, joins the hero as the scene ends (`finishScene`).
    const company = state().npcs.find((npc) => npc.unit === run.npc)?.extras ?? [];
    const units = effect.code === undefined ? [run.npc] : company.filter((unit) => alive(unit) && GetUnitTypeId(unit) === rawcode(effect.code ?? ""));
    for (const unit of units) run.allies.push({ unit, tag: effect.tag });
  } else if (effect.kind === "hostile") {
    // The NPC himself, or his company of one unit type, turns as the scene ends (`finishScene`).
    const company = state().npcs.find((npc) => npc.unit === run.npc)?.extras ?? [];
    const units = effect.code === undefined ? [run.npc] : company.filter((unit) => alive(unit) && GetUnitTypeId(unit) === rawcode(effect.code ?? ""));
    for (const unit of units) run.turns.push({ unit, tag: effect.tag, hold: effect.hold ?? 0 });
    if (effect.bounty !== undefined) addBounty(seat, effect.tag, effect.bounty);
  } else {
    // Behind the hero, up the road; around the NPC's site; or at a camp past it, away from the map's center:
    // held until the scene ends, then coming for him. At the scene's objective they stand guard there instead.
    const npc = pointOf(run.npc);
    const away = atan2Tenths(hero.y - npc.y, hero.x - npc.x);
    const outward = atan2Tenths(npc.y - state().center.y, npc.x - state().center.x);
    const camp = offset(npc.x, npc.y, outward, CAMP_DISTANCE, 0);
    const objective = effect.at === "objective" ? objectivePoint(run.scene) : undefined;
    for (let index = 0; index < effect.count; index++) {
      const around = floorDiv(index * 3600, effect.count);
      const spot = objective !== undefined ? offset(objective.x, objective.y, around, OBJECTIVE_RADIUS, 0)
        : effect.at === "site" ? offset(npc.x, npc.y, around, SITE_RADIUS, 0)
        : effect.at === "camp" ? offset(camp.x, camp.y, around, CAMP_RADIUS, 0)
        : offset(hero.x, hero.y, away, FIGHT_DISTANCE, (index * 2 - effect.count + 1) * 90);
      const enemy = CreateUnit(Player(PLAYER_NEUTRAL_AGGRESSIVE), rawcode(effect.code), spot.x, spot.y, atan2Tenths(hero.y - spot.y, hero.x - spot.x) / 10);
      if (objective === undefined) {
        PauseUnit(enemy, true);
        run.paused.push(enemy);
        run.fights.push(enemy);
      }
      if (effect.tag !== undefined) tagUnit(seat, effect.tag, enemy);
    }
    if (objective !== undefined && effect.tag !== undefined) markObjective(seat, effect.tag, objective, run.scene.objective?.name ?? "the objective");
    if (effect.tag !== undefined && effect.bounty !== undefined) addBounty(seat, effect.tag, effect.bounty);
  }
}

/** Where a scene's objective stands on this map (`objectiveSpot`), or undefined for a scene without one. */
function objectivePoint(scene: Scene): Point | undefined {
  if (scene.objective === undefined) return undefined;
  const area = bj_mapInitialPlayableArea;
  return objectiveSpot(state().center, scene.objective, {
    minX: Math.floor(GetRectMinX(area)), minY: Math.floor(GetRectMinY(area)), maxX: Math.floor(GetRectMaxX(area)), maxY: Math.floor(GetRectMaxY(area)),
  });
}

/**
 * Marks a quest's objective on this player's minimap, once per tag: Warcraft's
 * quest objective icon, which every client makes and only he sees, a ping
 * there on his minimap, and a message naming the place. `questTick` takes the
 * icon down once every unit under the tag has fallen.
 */
function markObjective(seat: Seat, tag: string, spot: Point, name: string): void {
  const rps = state();
  const marks = rps.objectives ?? [];
  rps.objectives = marks;
  const key = `${seat.id}:${tag}`;
  if (marks.some((mark) => mark.key === key)) return;
  const skinned = SkinManagerGetLocalPath(OBJECTIVE_ICON_SKIN_KEY);
  const icon = CreateMinimapIcon(spot.x, spot.y, 255, 220, 0, skinned === "" ? OBJECTIVE_ICON_FILE : skinned, FOG_OF_WAR_MASKED);
  SetMinimapIconVisible(icon, false);
  if (isLocal(seat)) {
    SetMinimapIconVisible(icon, true);
    PingMinimapEx(spot.x, spot.y, OBJECTIVE_PING_SECONDS, 255, 220, 0, false);
  }
  marks.push({ key, icon });
  say(seat, `${name.charAt(0).toUpperCase()}${name.slice(1)} is marked on your map.`);
}

/** Files a unit a scene raised or turned under its tag, for this player. */
function tagUnit(seat: Seat, tag: string, unit: unit): void {
  const rps = state();
  const tagged = rps.tagged ?? new Map<string, unit[]>();
  rps.tagged = tagged;
  const key = `${seat.id}:${tag}`;
  const units = tagged.get(key) ?? [];
  units.push(unit);
  tagged.set(key, units);
}

/** A bounty for this player on a tag, once: it pays when every unit under the tag has fallen (`questTick`). */
function addBounty(seat: Seat, tag: string, bounty: Bounty): void {
  const rps = state();
  const bounties = rps.bounties ?? [];
  rps.bounties = bounties;
  const key = `${seat.id}:${tag}`;
  if (!bounties.some((entry) => entry.key === key)) bounties.push({ seat: seat.id, key, bounty });
}

/**
 * Every 0.5 s: turned units whose daze is over come for their hero; allies
 * whose fight is won go back to their post, neutral again; and a bounty whose
 * tag's units have all fallen pays its gold, sets its flag and tells its
 * player.
 */
function questTick(): void {
  const rps = state();
  const tick = now();
  const held = rps.held ?? [];
  rps.held = held.filter((entry) => {
    if (tick < entry.until) return true;
    const seat = rps.seats.find((candidate) => candidate.id === entry.seat);
    PauseUnit(entry.unit, false);
    if (seat !== undefined && alive(entry.unit)) IssueTargetOrder(entry.unit, "attack", seat.hero);
    return false;
  });
  const won = (key: string) => {
    const units = rps.tagged?.get(key) ?? [];
    return units.length > 0 && !units.some((unit) => alive(unit));
  };
  const allies = rps.allies ?? [];
  rps.allies = allies.filter((entry) => {
    if (!won(entry.key)) return true;
    SetUnitOwner(entry.unit, Player(PLAYER_NEUTRAL_PASSIVE), false);
    IssuePointOrder(entry.unit, "move", entry.post.x, entry.post.y);
    return false;
  });
  const objectives = rps.objectives ?? [];
  rps.objectives = objectives.filter((mark) => {
    if (!won(mark.key)) return true;
    DestroyMinimapIcon(mark.icon);
    return false;
  });
  const bounties = rps.bounties ?? [];
  rps.bounties = bounties.filter((entry) => {
    const units = rps.tagged?.get(entry.key) ?? [];
    if (units.length === 0 || units.some((unit) => alive(unit))) return true;
    const seat = rps.seats.find((candidate) => candidate.id === entry.seat);
    if (seat === undefined) return false;
    SetPlayerState(seat.player, PLAYER_STATE_RESOURCE_GOLD, goldOf(seat) + entry.bounty.gold);
    if (entry.bounty.flag !== undefined) flagsOf(seat).add(entry.bounty.flag);
    say(seat, entry.bounty.text);
    return false;
  });
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

/**
 * The local player's scene camera, every tick: the line's framing as
 * `sceneFraming` has it this tick (gliding, then drifting), locked to the
 * hero by an offset, at the speaker's face height on a slope. A cut's first
 * tick is instant; the rest move over one tick, so the glide runs smooth.
 */
function applySceneCamera(seat: Seat, run: SceneRun, hero: Point): void {
  if (run.to === undefined) return;
  const rps = state();
  const elapsed = now() - run.lineStart;
  const shot = sceneFraming(run.from, run.to, elapsed, run.lineLength);
  const duration = elapsed === 0 && run.from === undefined ? 0 : CAMERA_PERIOD;
  SetCameraTargetController(seat.hero, shot.target.x - hero.x, shot.target.y - hero.y, false);
  SetCameraField(CAMERA_FIELD_ROTATION, shot.yaw / 10, duration);
  SetCameraField(CAMERA_FIELD_TARGET_DISTANCE, shot.distance, duration);
  SetCameraField(CAMERA_FIELD_ANGLE_OF_ATTACK, shot.attack / 10, duration);
  SetCameraField(CAMERA_FIELD_FIELD_OF_VIEW, shot.fieldOfView, duration);
  // Heads stay framed on a slope: the camera rises by however far the speaker stands above the shot's target.
  MoveLocation(rps.location, run.speakerAt.x, run.speakerAt.y);
  const speakerZ = GetLocationZ(rps.location);
  MoveLocation(rps.location, shot.target.x, shot.target.y);
  const targetZ = GetLocationZ(rps.location);
  SetCameraField(CAMERA_FIELD_ZOFFSET, (run.face ?? FACE_HEIGHT) + Math.max(0, speakerZ - targetZ), duration);
}

function stopVoice(run: SceneRun): void {
  if (run.voice !== undefined) StopSound(run.voice, false, true);
  run.voice = undefined;
}

/** The line after this one, or the end: a line with choices waits for one. */
function advance(seat: Seat, run: SceneRun): void {
  if (run.node.choices !== undefined) return;
  const next = lineAt(seat, run, run.node.next);
  if (next === undefined) endScene(seat, run);
  else playLine(seat, run, next);
}

/** Space: skips a line without choices, cutting its voice short. */
function skipLine(seat: Seat, run: SceneRun): void {
  if (run.closing === undefined && run.node.choices === undefined) advance(seat, run);
}

/** A choice, by click or 1 to 4, jumps to its node, if the player can take it. */
function chooseLine(seat: Seat, run: SceneRun, index: number): void {
  const choice = run.node.choices?.[index];
  if (run.closing !== undefined || choice === undefined || !meets(choice.when, flagsOf(seat), goldOf(seat), seat.heroInfo.code)) return;
  const next = lineAt(seat, run, choice.next);
  if (next === undefined) endScene(seat, run);
  else playLine(seat, run, next);
}

/**
 * Every camera tick of a scene: a line without choices advances when its time
 * is up, and, once the scene is closing, it finishes when the fade to black
 * has. The player's own client moves the camera.
 */
function sceneTick(seat: Seat, run: SceneRun): void {
  const hero = pointOf(seat.hero);
  if (run.closing !== undefined) {
    if (now() - run.closing >= FADE_TICKS) return finishScene(seat, run);
  } else {
    talkTick(run);
    if (run.node.choices === undefined && now() >= run.endTick) advance(seat, run);
  }
  if (seat.scene !== run || !isLocal(seat)) return;
  applySceneCamera(seat, run, hero);
}

/** Ends the scene, at its last line or on Esc: the voice stops, the panel and the choices go and the screen fades to black (`finishScene` follows). */
function endScene(seat: Seat, run: SceneRun): void {
  if (run.closing !== undefined) return;
  stopVoice(run);
  run.closing = now();
  seat.fade = { start: now(), toBlack: true };
  if (seat.letterbox !== undefined) {
    showChoices(seat.letterbox, []);
    showSubtitle(seat.letterbox, "", "");
  }
}

/**
 * Finishes the scene under the black: units unpause, any enemies the scene
 * raised come for the hero, the hero can be hurt again, the actors stand, the
 * player remembers the scene, the HUD and the hero's camera come back, and
 * the screen fades in from black.
 */
function finishScene(seat: Seat, run: SceneRun): void {
  for (const unit of run.paused) PauseUnit(unit, false);
  for (const enemy of run.fights) IssueTargetOrder(enemy, "attack", seat.hero);
  // Those the scene turned join the hostile creeps, can be hurt, and come for the hero, dazed a while first if held.
  // Those who promised to help join the hero's side, can't be hurt, and go at the enemy; `questTick` sends them home after.
  // With an objective, they set out for it; without, they go at the hero's foes where he stands.
  const rally = run.allies.length > 0 ? objectivePoint(run.scene) ?? pointOf(seat.hero) : undefined;
  for (const ally of run.allies) {
    const allies = state().allies ?? [];
    allies.push({ unit: ally.unit, key: `${seat.id}:${ally.tag}`, post: pointOf(ally.unit) });
    state().allies = allies;
    SetUnitOwner(ally.unit, seat.player, false);
    if (rally !== undefined) IssuePointOrder(ally.unit, "attack", rally.x, rally.y);
  }
  for (const turn of run.turns) {
    SetUnitInvulnerable(turn.unit, false);
    SetUnitOwner(turn.unit, Player(PLAYER_NEUTRAL_AGGRESSIVE), true);
    tagUnit(seat, turn.tag, turn.unit);
    if (turn.hold <= 0) IssueTargetOrder(turn.unit, "attack", seat.hero);
    else {
      PauseUnit(turn.unit, true);
      const held = state().held ?? [];
      held.push({ unit: turn.unit, until: now() + floorDiv(turn.hold * 100, 3), seat: seat.id });
      state().held = held;
    }
  }
  for (const actor of [seat.hero, run.npc, run.squad]) if (actor !== undefined) SetUnitAnimation(actor, "stand");
  SetUnitInvulnerable(seat.hero, false);
  flagsOf(seat).add(seenFlag(run.scene));
  seat.scene = undefined;
  seat.talkedTo = run.npc;
  seat.fade = { start: now(), toBlack: false };
  markNews(seat);
  if (isLocal(seat)) {
    if (seat.letterbox !== undefined) BlzFrameSetVisible(seat.letterbox.root, false);
    if (seat.hud !== undefined) BlzFrameSetVisible(seat.hud.root, true);
    SetCameraTargetController(seat.hero, 0, 0, false);
  }
  // Warcraft's interface comes back as it was: everything goes where the map keeps it again.
  arrangeInterface();
}

/** Every camera tick: a player's fade runs its course on his own screen, and is dropped once it has faded in. */
function fadeTick(seat: Seat): void {
  const fade = seat.fade;
  if (fade === undefined) return;
  const elapsed = now() - fade.start;
  if (isLocal(seat) && seat.letterbox !== undefined) setFade(seat.letterbox, off("fade") ? 0 : fadeAlpha(elapsed, fade.toBlack));
  if (!fade.toBlack && elapsed >= FADE_TICKS) seat.fade = undefined;
}

// Picking: each player chooses a race, then one of its heroes, by click or
// with 1 to 4 (0 goes back); PICK_SECONDS in, whoever hasn't gets the default.

function pickOf(target: player): Pick | undefined {
  const id = GetPlayerId(target);
  return state().picks.find((pick) => pick.id === id && !pick.done);
}

function showPick(pick: Pick): void {
  if (pick.race === undefined) showPicker(pick.menu, "Choose your race", RACES.map((race) => race.name), false);
  else showPicker(pick.menu, `Choose your ${raceOf(pick.race).name} hero`, raceOf(pick.race).heroes.map((hero) => hero.name), true);
}

/** A choice (0 to 3) or "back" on a player's picker: a race, then a hero, which spawns them. */
function choose(pick: Pick, choice: number | "back"): void {
  if (choice === "back") pick.race = undefined;
  else if (pick.race === undefined) pick.race = choice;
  else return finishPick(pick, pick.race, choice);
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

/** The pick time is up: everyone still choosing gets their race's first hero, or the default. */
function pickTimeout(): void {
  for (const pick of state().picks) {
    if (pick.done) continue;
    if (pick.race === undefined) finishPick(pick, DEFAULT_PICK.race, DEFAULT_PICK.hero);
    else finishPick(pick, pick.race, 0);
  }
}

/** Spawns the picked hero and the race's army on the player's start location and hands them the interface. */
function finishPick(pick: Pick, race: number, hero: number): void {
  const rps = state();
  pick.done = true;
  BlzFrameSetVisible(pick.menu.root, false);
  const start = startOf(pick.id);
  const seat = spawnSeat(pick.id, start.x, start.y, raceOf(race), heroOf(race, hero));
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
  say(seat, `WASD moves the ${seat.heroInfo.name}, hold the right mouse button and drag to turn the camera, left click or Space swings, hold Q to guard (early: parry), Tab targets, F sends the squad at it, 1 Vanguard, 2 Tight Guard. Skills: ${keys}; click the spell bar too, + or L learns. 6 to 0 and - switch cameras. Your party is empty: walk up to the quartermaster nearby to recruit soldiers, and to the sergeant by a tavern to talk (Space skips a line, 1 to 4 choose, Esc leaves). Hold outposts for gold.`);
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
  // The hero swings only when the player does: no attack ability, so no auto-attack.
  UnitRemoveAbility(hero, ATTACK_ABILITY);
  // The party starts empty: soldiers are recruited from the quartermaster, with the starting gold.
  const squad: Member[] = [];
  SetPlayerState(player, PLAYER_STATE_RESOURCE_GOLD, STARTING_GOLD);
  return {
    id, player, hero, race, heroInfo, squad, keys: { w: false, a: false, s: false, d: false },
    fight: { swing: undefined, step: 0, recoverTick: 0, guardTick: undefined, poseTick: undefined, frozen: [], thawTick: 0, speed: Math.floor(GetUnitDefaultMoveSpeed(hero)), pending: undefined, barTick: -100, shots: [], buffered: undefined, impactTicks: IMPACT_TICKS, guardPose: undefined, guardEffect: undefined, staggerUntil: 0 },
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
    rps.picks.push({ id, player, race: undefined, done: false, menu: createPicker(id, rps.clicks) });
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

