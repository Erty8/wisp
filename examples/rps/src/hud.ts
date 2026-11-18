// The RPS map's own interface, drawn with Warcraft 1.31+ frames in place of
// the classic console: health and mana bars in the bottom-left corner, and a spell bar at the bottom center,
// one slot per skill with its icon, key, rank and cooldown, and a learn
// button above it while the hero can learn it. Nothing is ever selected, so
// the slots' buttons are how the player casts and learns with the mouse.
// Every client creates and fills every player's HUD the same way; the caller
// shows each player only their own.
import { f32 } from "wisp/src/sim/f32";
import { type Box, LIFE_BAR, MANA_BAR, SPELL_SLOTS, learnButton, spellSlot } from "./layout";
import { barWidth } from "./rules";

/** Screen units (the 0.8 by 0.6 frame space) from thousandths. */
const ui = (thousandths: number) => f32(thousandths / 1000);

const BLACK = "Textures\\Black32.blp";
const GREEN = "ReplaceableTextures\\TeamColor\\TeamColor06.blp";
const BLUE = "ReplaceableTextures\\TeamColor\\TeamColor01.blp";
/** Warcraft's hero skill button icon: the red cross a hero's learn menu shows. */
const LEARN_ICON = "ReplaceableTextures\\CommandButtons\\BTNSkillz.blp";

interface SlotFrames {
  readonly icon: framehandle;
  readonly button: framehandle;
  readonly key: framehandle;
  readonly rank: framehandle;
  readonly cooldown: framehandle;
  readonly learn: framehandle;
  readonly learnButton: framehandle;
}

export interface Hud {
  readonly root: framehandle;
  readonly life: framehandle;
  readonly lifeText: framehandle;
  readonly mana: framehandle;
  readonly slots: readonly SlotFrames[];
}

/** One slot as the bar shows it. */
export interface SlotView {
  readonly icon: string;
  readonly key: string;
  readonly rank: string;
  /** Whole seconds left, or "" when ready. */
  readonly cooldown: string;
  readonly learnable: boolean;
}

export interface HudView {
  readonly life: number;
  readonly maxLife: number;
  /** Whole percents. */
  readonly lifePercent: number;
  readonly manaPercent: number;
  readonly slots: readonly SlotView[];
}

export type HudAction = { readonly kind: "cast" | "learn"; readonly slot: number };

function backdrop(parent: framehandle, context: number, texture: string, box: Box): framehandle {
  const frame = BlzCreateFrameByType("BACKDROP", "RpsHudArt", parent, "", context);
  BlzFrameSetTexture(frame, texture, 0, true);
  BlzFrameSetAbsPoint(frame, FRAMEPOINT_BOTTOMLEFT, ui(box.left), ui(box.bottom));
  BlzFrameSetSize(frame, ui(box.width), ui(box.height));
  BlzFrameSetEnable(frame, false);
  return frame;
}

function text(parent: framehandle, context: number, box: Box, vertical: textaligntype, horizontal: textaligntype): framehandle {
  const frame = BlzCreateFrameByType("TEXT", "RpsHudText", parent, "", context);
  BlzFrameSetAbsPoint(frame, FRAMEPOINT_BOTTOMLEFT, ui(box.left), ui(box.bottom));
  BlzFrameSetSize(frame, ui(box.width), ui(box.height));
  BlzFrameSetTextAlignment(frame, vertical, horizontal);
  BlzFrameSetEnable(frame, false);
  return frame;
}

function button(parent: framehandle, context: number, box: Box, clicks: trigger): framehandle {
  const frame = BlzCreateFrameByType("BUTTON", "RpsHudButton", parent, "", context);
  BlzFrameSetAbsPoint(frame, FRAMEPOINT_BOTTOMLEFT, ui(box.left), ui(box.bottom));
  BlzFrameSetSize(frame, ui(box.width), ui(box.height));
  BlzTriggerRegisterFrameEvent(clicks, frame, FRAMEEVENT_CONTROL_CLICK);
  return frame;
}

/** Creates one player's HUD; its slot and learn buttons register their clicks on `clicks`. */
export function createHud(context: number, clicks: trigger): Hud {
  const root = BlzCreateFrameByType("FRAME", "RpsHud", BlzGetOriginFrame(ORIGIN_FRAME_GAME_UI, 0), "", context);
  backdrop(root, context, BLACK, LIFE_BAR);
  const life = backdrop(root, context, GREEN, LIFE_BAR);
  const lifeText = text(root, context, LIFE_BAR, TEXT_JUSTIFY_MIDDLE, TEXT_JUSTIFY_CENTER);
  backdrop(root, context, BLACK, MANA_BAR);
  const mana = backdrop(root, context, BLUE, MANA_BAR);
  const slots: SlotFrames[] = [];
  for (let index = 0; index < SPELL_SLOTS; index++) {
    const box = spellSlot(index);
    const icon = backdrop(root, context, BLACK, box);
    const slotButton = button(root, context, box, clicks);
    const key = text(root, context, { left: box.left + 3, bottom: box.bottom + box.height - 13, width: 12, height: 11 }, TEXT_JUSTIFY_TOP, TEXT_JUSTIFY_LEFT);
    const rank = text(root, context, { left: box.left, bottom: box.bottom + 2, width: box.width - 3, height: 11 }, TEXT_JUSTIFY_BOTTOM, TEXT_JUSTIFY_RIGHT);
    const cooldown = text(root, context, box, TEXT_JUSTIFY_MIDDLE, TEXT_JUSTIFY_CENTER);
    const learnBox = learnButton(index);
    const learn = backdrop(root, context, LEARN_ICON, learnBox);
    slots.push({ icon, button: slotButton, key, rank, cooldown, learn, learnButton: button(root, context, learnBox, clicks) });
  }
  return { root, life, lifeText, mana, slots };
}

/** What a clicked frame (by handle id) asks for: casting a slot's skill or learning it. */
export function hudAction(hud: Hud, clickedId: number): HudAction | undefined {
  for (let slot = 0; slot < hud.slots.length; slot++) {
    const frames = hud.slots[slot];
    if (frames === undefined) continue;
    if (GetHandleId(frames.button) === clickedId) return { kind: "cast", slot };
    if (GetHandleId(frames.learnButton) === clickedId) return { kind: "learn", slot };
  }
  return undefined;
}

export function showHud(hud: Hud, view: HudView): void {
  BlzFrameSetSize(hud.life, ui(barWidth(view.lifePercent, LIFE_BAR.width)), ui(LIFE_BAR.height));
  BlzFrameSetText(hud.lifeText, `${view.life} / ${view.maxLife}`);
  BlzFrameSetSize(hud.mana, ui(barWidth(view.manaPercent, MANA_BAR.width)), ui(MANA_BAR.height));
  hud.slots.forEach((frames, index) => {
    const slot = view.slots[index];
    if (slot === undefined) return;
    BlzFrameSetTexture(frames.icon, slot.icon, 0, true);
    BlzFrameSetText(frames.key, slot.key);
    BlzFrameSetText(frames.rank, slot.rank);
    BlzFrameSetText(frames.cooldown, slot.cooldown);
    BlzFrameSetVisible(frames.learn, slot.learnable);
    BlzFrameSetVisible(frames.learnButton, slot.learnable);
  });
}
