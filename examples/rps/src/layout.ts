// The RPS map's own interface, in place of Warcraft's (which all goes below
// the screen apart from the minimap, in the top-right corner): health and
// mana bars in the bottom-left corner and a spell bar at the bottom center, so
// the low camera's view stays open. Boxes are in thousandths of the 0.8 by 0.6 frame
// space, measured from the bottom-left corner.
import { floorDiv } from "wisp/src/sim/intMath";

export interface Box {
  readonly left: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export const SCREEN_WIDTH = 800;
export const SCREEN_HEIGHT = 600;
const MARGIN = 5;

/** The health bar, and the mana bar under it, in the bottom-left corner. */
export const LIFE_BAR: Box = { left: MARGIN, bottom: 17, width: 130, height: 12 };
export const MANA_BAR: Box = { left: MARGIN, bottom: MARGIN, width: 130, height: 8 };

/** The minimap: 130 square in the top-right corner of the 4:3 frame space, 5 in from its edges. */
export const MINIMAP_SIZE = 130;
export const MINIMAP: Box = { left: SCREEN_WIDTH - MARGIN - MINIMAP_SIZE, bottom: SCREEN_HEIGHT - MARGIN - MINIMAP_SIZE, width: MINIMAP_SIZE, height: MINIMAP_SIZE };

/** The spell bar: 4 square slots at the bottom center, each with its learn button above it. */
export const SPELL_SLOTS = 4;
const SLOT_SIZE = 40, SLOT_STEP = 46, SLOT_BOTTOM = 18, LEARN_SIZE = 16;
const SLOTS_LEFT = floorDiv(SCREEN_WIDTH, 2) - floorDiv(SPELL_SLOTS * SLOT_STEP - (SLOT_STEP - SLOT_SIZE), 2);

export function spellSlot(index: number): Box {
  return { left: SLOTS_LEFT + index * SLOT_STEP, bottom: SLOT_BOTTOM, width: SLOT_SIZE, height: SLOT_SIZE };
}

export function learnButton(index: number): Box {
  const slot = spellSlot(index);
  return { left: slot.left + floorDiv(SLOT_SIZE - LEARN_SIZE, 2), bottom: slot.bottom + SLOT_SIZE + 3, width: LEARN_SIZE, height: LEARN_SIZE };
}

/** The race and hero picker shown at the start: a panel at the center with a title, 4 choices and a back button. */
export const PICKER_PANEL: Box = { left: 250, bottom: 215, width: 300, height: 235 };
export const PICKER_TITLE: Box = { left: 260, bottom: 410, width: 280, height: 30 };
export const PICKER_CHOICES = 4;
export function pickerChoice(index: number): Box {
  return { left: 270, bottom: 370 - index * 38, width: 260, height: 32 };
}
export const PICKER_BACK: Box = { left: 340, bottom: 222, width: 120, height: 28 };

/** Every box of the picker, by name. */
export function pickerBoxes(): readonly { readonly name: string; readonly box: Box }[] {
  return [
    { name: "title", box: PICKER_TITLE },
    ...Array.from({ length: PICKER_CHOICES }, (_, index) => ({ name: `choice ${index}`, box: pickerChoice(index) })),
    { name: "back", box: PICKER_BACK },
  ];
}

/** A scene's line, as plain text centered low on the screen, the speaker's name over it; its up to 4 choices stack at the right above it. */
export const SUBTITLE: Box = { left: 100, bottom: 60, width: 600, height: 60 };
/** The black a scene fades through: the whole window. */
export const FADE_BOX: Box = { left: -400, bottom: 0, width: 1600, height: 600 };

export const SCENE_CHOICES = 4;
export function sceneChoice(index: number): Box {
  return { left: 540, bottom: SUBTITLE.bottom + SUBTITLE.height + 10 + (SCENE_CHOICES - 1 - index) * 34, width: 250, height: 30 };
}

/** How far below the screen the parts the map leaves out go. */
export const OFF_SCREEN = 500;
/** A box below the screen, for parts the layout leaves out. */
export const OFF_SCREEN_BOX: Box = { left: 0, bottom: -OFF_SCREEN, width: 1, height: 1 };

/** Every box the layout places on screen, by name. */
export function layoutBoxes(): readonly { readonly name: string; readonly box: Box }[] {
  return [
    { name: "minimap", box: MINIMAP },
    { name: "life bar", box: LIFE_BAR },
    { name: "mana bar", box: MANA_BAR },
    ...Array.from({ length: SPELL_SLOTS }, (_, index) => ({ name: `spell ${index}`, box: spellSlot(index) })),
    ...Array.from({ length: SPELL_SLOTS }, (_, index) => ({ name: `learn ${index}`, box: learnButton(index) })),
  ];
}

export function overlaps(a: Box, b: Box): boolean {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.bottom < b.bottom + b.height && b.bottom < a.bottom + a.height;
}
