// The RPS map's constants: timers, speeds, models and textures, Warcraft's
// order ids and the keys the map listens to. Kept apart from main.ts, whose
// compiled Lua chunk may hold at most 200 locals; an imported constant is read
// through its module and takes none.
import { f32 } from "wisp/src/sim/f32";
import { fourCC } from "./rules";

export const SEATS = 2;
export const CAMERA_PERIOD = f32(0.03);
export const OCCLUSION_PERIOD = f32(0.1);
export const STANCE_PERIOD = 0.5;
/** E picks up an item on the ground this close to the hero. */
export const PICKUP_RANGE = 200;
/** A hero's inventory slots, as Warcraft gives every hero. */
export const INVENTORY_SLOTS = 6;
/** Seconds after start before the interface is rearranged. */
export const ARRANGE_DELAY = 1.0;
export const HUD_PERIOD = f32(0.1);
export const CAPTURE_PERIOD = 1.0;
export const INCOME_PERIOD = 5.0;
/** WASD re-issues its 250-unit move every fifth camera tick (0.15 s) while held. */
export const MOVE_EVERY_TICKS = 5;
export const DEAD_LIFE = f32(0.405);

/** The spell bar's keys, by skill: 3, 4 and 5 for the three basic skills, R for the ultimate. */
export const SKILL_KEYS = ["1", "2", "3", "4"];
/** A low 0.15 s camera sway on impact: noise magnitude and velocity for both the eye and the target. */
export const SHAKE_MAGNITUDE = 4.0;
export const SHAKE_VELOCITY = 100.0;
/** Swings play 1.4 times faster, so the wind-up is snappy; a parry's counter-slash twice as fast. */
export const SWING_SPEED = f32(1.4);
export const COUNTER_SPEED = 2.0;
export const SLASH_MODEL = "Abilities\\Spells\\Other\\Stampede\\StampedeMissileDeath.mdl";
export const PARRY_MODEL = "Abilities\\Weapons\\Bolt\\BoltImpact.mdl";
export const BLOCK_MODEL = "Abilities\\Spells\\Human\\Defend\\DefendCaster.mdl";
/** Mana Shield's bubble, on the hero while his guard is up: blocks spend his mana, as Mana Shield does. */
export const GUARD_MODEL = "Abilities\\Spells\\Human\\ManaShield\\ManaShieldCaster.mdl";
/** A guarding hero walks at 0.6 times animation speed, as he moves at 3/5 speed. */
export const GUARD_WALK_SPEED = f32(0.6);
/** A block's recoil replays the guard pose at 1.5 times speed before it freezes again. */
export const RECOIL_SPEED = 1.5;
export const FLOAT_TEXT_SIZE = f32(0.024);
export const FLOAT_TEXT_RISE = f32(0.03);
/** The hero's built-in attack: removed, so he swings only when the player does. */
export const ATTACK_ABILITY = fourCC("Aatk");
/** Night elf Shadowmeld (the units' and the heroes' versions): idle at night, a unit with it turns invisible, so the map takes it from NPCs. */
export const SHADOWMELD_ABILITIES = [fourCC("Ashm"), fourCC("Sshm")];
export const OUTPOST = fourCC("ncop");
/** Warcraft's order ids for move and the right-click "smart" order. */
export const ORDER_MOVE = 851986;
export const ORDER_SMART = 851971;
/** The sync prefix a player's dragged camera yaw travels under. */
export const YAW_PREFIX = "rpsyaw";
export const TAVERN = fourCC("ntav");
/** In a scene, the speaker and the listener turn to each other over 0.3 s. */
export const TURN_SECONDS = f32(0.3);
export const GOLD_MINE = fourCC("ngol");
export const CREEPS = [fourCC("ngno"), fourCC("ngno"), fourCC("ngnb")];
/** Screen units (the 0.8 by 0.6 frame space) from thousandths. */
export const ui = (thousandths: number) => f32(thousandths / 1000);
/** The soft target's ring on the ground: Warcraft's spell-area circle, tinted red. */
export const RING_TEXTURE = "ReplaceableTextures\\Selection\\SpellAreaOfEffect.blp";
/** Warcraft's image types: 1 draws like a selection circle, over the ground. */
export const IMAGE_TYPE_SELECTION = 1;
/** The target's tint, on the targeting player's screen only: a red cast. */
export const TARGET_TINT = { red: 255, green: 130, blue: 130 } as const;

/** The "!" over an NPC with something new to say: Warcraft's own talk-to-me mark. */
export const NEWS_MODEL = "Abilities\\Spells\\Other\\TalkToMe\\TalkToMe.mdl";
/** Warcraft's quest giver minimap icon: its interface skin key, and its file. */
export const QUEST_ICON_SKIN_KEY = "MinimapQuestGiverIcon";
export const QUEST_ICON_FILE = "UI\\Minimap\\MiniMap-QuestGiver.mdl";
/** The sync prefix a scene line's measured voice length travels under. */
export const VOICE_PREFIX = "rpsvoice";
/** Enemies a scene raises come from this far behind the hero. */
export const FIGHT_DISTANCE = 700;
/** Enemies a scene raises at its site stand this far around the NPC; at a camp, this far past him and this far around its middle. */
export const SITE_RADIUS = 300;
export const CAMP_DISTANCE = 900;
export const CAMP_RADIUS = 150;
/** Enemies waiting at a quest's objective stand this far around it. */
export const OBJECTIVE_RADIUS = 200;
/** Warcraft's quest objective minimap icon: its interface skin key, and its file. */
export const OBJECTIVE_ICON_SKIN_KEY = "MinimapQuestObjectivePrimary";
export const OBJECTIVE_ICON_FILE = "UI\\Minimap\\MiniMap-QuestObjectivePrimary.mdl";
/** The icon every quest shows in Warcraft's quest log: a scroll. */
export const QUEST_LOG_ICON = "ReplaceableTextures\\CommandButtons\\BTNSnazzyScroll.blp";
/** How long the minimap pings a new objective, in seconds. */
export const OBJECTIVE_PING_SECONDS = 4;
export const BARK_TEXT_SIZE = FLOAT_TEXT_SIZE;

/**
 * The keys, as Warcraft's OSKEY_* constants are defined in common.j:
 * ConvertOsKeyType of the virtual-key code. A key event reports the same code
 * as GetHandleId of its key.
 */
export const KEY = { escape: 0x1b, minus: 0xbd, tab: 0x09, space: 0x20, zero: 0x30, one: 0x31, two: 0x32, three: 0x33, four: 0x34, five: 0x35, six: 0x36, seven: 0x37, eight: 0x38, nine: 0x39, a: 0x41, c: 0x43, d: 0x44, e: 0x45, i: 0x49, l: 0x4c, q: 0x51, s: 0x53, w: 0x57, x: 0x58, z: 0x5a } as const;
/** Registration order: an array, since Lua walks a table's keys in no fixed order. */
export const KEY_CODES = [KEY.escape, KEY.minus, KEY.space, KEY.q, KEY.l, KEY.w, KEY.a, KEY.s, KEY.d, KEY.tab, KEY.z, KEY.x, KEY.c, KEY.e, KEY.i, KEY.one, KEY.two, KEY.three, KEY.four, KEY.five, KEY.six, KEY.seven, KEY.eight, KEY.nine, KEY.zero];
/** The skill keys, by skill. */
export const SKILL_KEY_CODES: readonly number[] = [KEY.one, KEY.two, KEY.three, KEY.four];
/** The picker's choice keys. */
export const PICK_KEYS: readonly number[] = [KEY.one, KEY.two, KEY.three, KEY.four];
/** The camera keys, in CAMERA_PRESETS order. */
export const CAMERA_KEYS: readonly number[] = [KEY.six, KEY.seven, KEY.eight, KEY.nine, KEY.zero, KEY.minus];
