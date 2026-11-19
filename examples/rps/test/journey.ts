// The RPS headless journey, declared once for Bun and 32-bit Lua: both
// both players, Human in the lobby, pick their race's heroes and a hero
// (player 1 by keys, player 2 by clicking the picker), player 1 presses L with no skill point, player 2 clicks Storm Bolt on the
// spell bar with no target, then they walk with W and D held together, press Tab with
// nobody in range, F with no target, switch stances, then a hot reload,
// the spell keys (headless, nothing is learned) and A held, which also closes
// Warcraft's attack cursor. Headless units take no orders and the map has no
// trees or terrain, so the journey checks the synchronized key handling, stance
// messages and timers, not where units go or what the camera shows.
import type { Journey } from "wisp/src/headless/journey";
import { fourCC } from "../src/rules";
import { UNITS } from "../src/units";

const LOOKS = "the journey checks key handling and messages, not what players see";
const ORDERS = "headless units take no orders, so nobody moves, fights or captures";
const QUERIES = "headless has no unit, tree or item queries: enemies, outposts, trees and items on the ground are never found";
const CAMERA = "moves only this player's camera, to their own hero";
const alive = (life: number) => ({ life, maxLife: life, mana: 0, maxMana: 0 });

/** Every profiled unit type's starting life, by rawcode. */
function unitStates(): Record<number, ReturnType<typeof alive>> {
  const states: Record<number, ReturnType<typeof alive>> = {};
  for (const code of Object.keys(UNITS)) states[fourCC(code)] = alive(UNITS[code]?.life ?? 1);
  return states;
}

/** What a headless run needs to know about the map: src/main.ts's configureRuntime() prefixes. */
export const RPS_MAP = {
  filePrefix: "rps", globalPrefixes: ["__rps"],
  // The playable rectangle is centered at the origin, and the ground is flat at height 0.
  // Every player has 150 gold, the starting gold, whenever the map reads it.
  natives: () => ({
    GetPlayerState: () => 150,
    GetRectCenterX: () => 0, GetRectCenterY: () => 0,
    GetLocationZ: () => 0, GetCameraEyePositionX: () => 0, GetCameraEyePositionY: () => 0,
    // Every voice recording runs 1.5 s.
    GetSoundFileDuration: () => 1500,
    // Every unit is 32 across its collision.
    BlzGetUnitCollisionSize: () => 32,
    // Every player is red, and chose Human in the lobby (headless gives a constant its own name as its value).
    GetPlayerColor: () => 0,
    GetPlayerRace: () => "RACE_HUMAN",
    // The interface skin has no quest giver key: the map falls back to the file.
    SkinManagerGetLocalPath: () => "",
    // Player N starts at start location N: player 1 west of the center, player 2 east of it.
    GetPlayerStartLocation: (player: number) => player,
    GetStartLocationX: (start: number) => (start === 0 ? -600 : 600), GetStartLocationY: () => -300,
  }),
  /** Starting life for every unit type the map creates, from its profile (src/units.ts), read by its alive checks. */
  unitStates: unitStates(),

  localNatives: {
    BlzIsMouseButtonPressed: "reads this player's own right mouse button, for their camera drag", BlzGetMouseScreenPosX: "reads this player's own pointer, for their camera drag",
    SetCameraField: CAMERA, SetSoundVolume: "silences a scene's voice for every player but the one in it", SetCameraPosition: "moves only this player's camera, to their start location while they pick", SetCameraTargetController: CAMERA,
    GetCameraEyePositionX: "reads this player's camera for its terrain lift", GetCameraEyePositionY: "reads this player's camera for its terrain lift",
    MoveLocation: "moves the camera's reused sample point", GetLocationZ: "samples terrain for this player's camera only",
    ShowDestructable: "hides trees only in front of this player's own camera",
    BlzFrameSetVisible: "shows each player only their own health bars; every client makes and fills all of them",
    BlzFrameSetAbsPoint: "places the portrait for this player's window shape", BlzFrameSetSize: "sizes the portrait for this player's window shape",
    CameraSetSourceNoise: "shakes only this player's camera", CameraSetTargetNoise: "shakes only this player's camera",
    GetSoundFileDuration: "measures a scene line's voice on the client that hears it, which sends the length to the others; every client also counts a set's recordings with it, alike",
    BlzFrameSetAlpha: "fades only this player's own screen in and out of a scene",
    BlzSetSpecialEffectAlpha: "hides each player's \"!\" over NPCs from every other player",
    SetTextTagVisibility: "shows an NPC's call only to the player it calls out to",
    ShowImage: "shows the target's ring only to the player who targets it",
    SetUnitVertexColor: "tints a target red only on the targeting player's screen",
    SetMinimapIconVisible: "shows each player only their own quest icons on the minimap",
  },
  intentionalNoops: {
    SetCameraTargetController: LOOKS, ShowDestructable: LOOKS,
    BlzEnableUIAutoPosition: LOOKS, EnableSelect: LOOKS, EnableDragSelect: LOOKS, ClearSelection: LOOKS, BlzGetFrameByName: "Warcraft's console frames by name; headless has none, so nothing is hidden", BlzFrameClearAllPoints: LOOKS,
    BlzGetUnitAbilityCooldownRemaining: "headless heroes learn nothing, so no spell recharges",
    GetUnitDefaultMoveSpeed: "the guard's slowdown isn't read back; headless units don't move",
    UnitDamageTarget: "headless swings find no enemies in range to damage",
    BlzSetEventDamage: "nothing fights headless, so no hit reaches a guard",
    BlzSetUnitName: LOOKS, SetUnitInvulnerable: "nothing fights headless, so a hero in a scene is never hit",
    GetUnitCurrentOrder: "headless units take no orders, so the hero never flees and holds no ground",
    SetUnitFacingTimed: LOOKS, QueueUnitAnimation: LOOKS,
    CreateMinimapIconOnUnit: LOOKS, SetMinimapIconVisible: LOOKS, DestroyMinimapIcon: LOOKS,
    SetUnitPropWindow: ORDERS, GetUnitDefaultPropWindow: ORDERS, SetSoundChannel: LOOKS, PauseUnit: "headless units take no orders, so pausing them changes nothing the journey checks",
    GetEventDamage: "nothing fights headless, so no hit reaches a guard",
    SetPlayerState: "food caps and gold aren't read back; the journey owns no outposts",
    IssuePointOrder: ORDERS, IssueTargetOrder: ORDERS, SetUnitOwner: ORDERS, IsPlayerEnemy: ORDERS,
    TriggerRegisterPlayerUnitEvent: "nothing fights headless, so no damage event fires",
    Filter: QUERIES, GroupEnumUnitsInRange: QUERIES, GroupEnumUnitsInRect: QUERIES, BlzGroupGetSize: QUERIES, BlzGroupUnitAt: QUERIES,
    SetRect: QUERIES, EnumDestructablesInRect: QUERIES, EnumItemsInRect: QUERIES,
    ConvertOsKeyType: "returns the key code, which is how journey key events name keys",
    IssueImmediateOrder: "headless units take no orders, so every spell key reports it can't cast",
    GetHeroSkillPoints: "headless heroes have no skill points, so nothing is learned",
    GetHeroLevel: "headless heroes have no skill points, so nothing is learned",
    SelectHeroSkill: "headless heroes have no skill points, so nothing is learned",
  },
};

/** Inside the spell bar's first slot (Storm Bolt), which spans x 0.311 to 0.351 and y 0.018 to 0.058 of the 0.8 by 0.6 screen. */
const STORM_BOLT_SLOT = { x: 0.328125, y: 0.0390625 };
/** Inside the picker's first choice (Human heroes), which spans x 0.27 to 0.53 and y 0.37 to 0.402, and its third (Mountain King), y 0.294 to 0.326. */
const FIRST_CHOICE = { x: 0.40625, y: 0.384765625 };
const THIRD_CHOICE = { x: 0.40625, y: 0.3125 };
/** The picker's second choice (Archmage among Human heroes), y 0.332 to 0.364. */
const SECOND_CHOICE = { x: 0.40625, y: 0.34765625 };
/** Inside a scene's second choice, which spans x 0.54 to 0.79 and y 0.198 to 0.228. */
const SCENE_SECOND_CHOICE = { x: 0.6640625, y: 0.2109375 };
const ESCAPE = 0x1b, SPACE = 0x20, E = 0x45, I = 0x49, Q = 0x51, L = 0x4c, W = 0x57, A = 0x41, D = 0x44, TAB = 0x09, F = 0x46, ONE = 0x31, TWO = 0x32, THREE = 0x33, FOUR = 0x34, FIVE = 0x35, NINE = 0x39, ZERO = 0x30, MINUS = 0xbd;

/** 60 frames a second: about 17 seconds, so every timer fires and both scenes end. */
export const RPS_JOURNEY: Journey = {
  frames: 1000,
  events: [
    // Player 1 picks with the keys (1 Human heroes, 0 back, 1 Human heroes, 3 Mountain King); player 2 clicks Human heroes,
    // then the ranged Archmage.
    { frame: 2, player: 0, key: ONE, meta: 0 },
    { frame: 3, player: 1, click: FIRST_CHOICE },
    { frame: 4, player: 0, key: ZERO, meta: 0 },
    { frame: 5, player: 0, key: ONE, meta: 0 },
    { frame: 6, player: 1, click: SECOND_CHOICE },
    { frame: 7, player: 0, key: THREE, meta: 0 },
    { frame: 30, player: 0, key: L, meta: 0 },
    { frame: 60, player: 1, click: STORM_BOLT_SLOT },
    { frame: 120, player: 0, key: W, meta: 0, down: true },
    { frame: 120, player: 0, key: D, meta: 0, down: true },
    { frame: 150, player: 0, key: D, meta: 0, down: false },
    { frame: 165, player: 0, key: W, meta: 0, down: false },
    { frame: 180, player: 0, key: TAB, meta: 0 },
    { frame: 190, player: 1, key: F, meta: 0 },
    { frame: 200, player: 0, key: TWO, meta: 0 },
    { frame: 240, reload: true },
    { frame: 300, player: 1, key: TWO, meta: 0 },
    { frame: 310, player: 1, key: ONE, meta: 0 },
    { frame: 320, player: 0, key: THREE, meta: 0 },
    { frame: 330, player: 0, key: FOUR, meta: 0 },
    { frame: 340, player: 1, key: FIVE, meta: 0 },
    { frame: 350, player: 0, key: A, meta: 0, down: true },
    { frame: 380, player: 0, key: A, meta: 0, down: false },
    { frame: 400, player: 0, key: NINE, meta: 0 },
    { frame: 410, player: 1, key: MINUS, meta: 0 },
    // Player 1 swings at the ground north of the hero and with Space; player 2 guards with right click, then with Q.
    { frame: 412, player: 0, playerMouse: { x: -600, y: 300, button: "left", down: true } },
    { frame: 412, player: 1, playerMouse: { x: 600, y: 300, button: "right", down: true } },
    { frame: 413, player: 0, playerMouse: { x: -600, y: 300, button: "left", down: false } },
    { frame: 430, player: 0, key: SPACE, meta: 0 },
    { frame: 431, player: 0, chat: "-impact 8" },
    { frame: 431, player: 1, key: SPACE, meta: 0 },
    { frame: 434, player: 0, key: SPACE, meta: 0 },
    { frame: 435, player: 1, playerMouse: { x: 600, y: 300, button: "right", down: false } },
    { frame: 438, player: 1, chat: "-guard 5 6" },
    { frame: 440, player: 1, key: Q, meta: 0, down: true },
    { frame: 445, player: 1, key: W, meta: 0, down: true },
    { frame: 450, player: 1, key: W, meta: 0, down: false },
    { frame: 455, player: 1, key: Q, meta: 0, down: false },
    { frame: 460, player: 0, chat: "-anim 3" },
    { frame: 462, player: 1, chat: "-combo 4 5 6" },
    // Player 1 presses E with nothing in reach (the quartermaster stands 400 off, past talking range);
    // player 2 opens and closes the inventory with I.
    { frame: 464, player: 0, key: E, meta: 0 },
    { frame: 465, player: 1, key: I, meta: 0 },
    { frame: 467, player: 1, key: I, meta: 0 },
    // Both talk to their quartermaster: player 1 hires Footmen (key 1) and leaves (key 3); player 2 hires
    // Riflemen with a click, tries them again, and leaves.
    { frame: 470, player: 0, chat: "-scene" },
    { frame: 480, player: 1, chat: "-scene" },
    { frame: 490, player: 0, key: ONE, meta: 0 },
    { frame: 495, player: 1, click: SCENE_SECOND_CHOICE },
    { frame: 500, player: 0, key: SPACE, meta: 0 },
    { frame: 505, player: 1, key: SPACE, meta: 0 },
    { frame: 520, player: 0, key: THREE, meta: 0 },
    { frame: 525, player: 1, key: TWO, meta: 0 },
    { frame: 530, player: 1, key: SPACE, meta: 0 },
    { frame: 545, player: 1, key: THREE, meta: 0 },
    { frame: 550, player: 0, key: SPACE, meta: 0 },
    // Player 1 goes back to the quartermaster, who now opens differently, and leaves with Esc.
    { frame: 760, player: 0, chat: "-scene" },
    { frame: 790, player: 0, key: ESCAPE, meta: 0 },
  ],
};
