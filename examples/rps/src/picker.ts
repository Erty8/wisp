// The race and hero picker each player sees at the start of an RPS match: a
// panel with a title, four choices (the races, then the chosen race's
// heroes) and a back button, in Warcraft's own dialog buttons. Every client
// creates and fills every player's picker the same way; the caller shows each
// player only their own and hides it once they have picked.
import { f32 } from "wisp/src/sim/f32";
import { type Box, PICKER_BACK, PICKER_CHOICES, PICKER_PANEL, PICKER_TITLE, pickerChoice } from "./layout";

/** Screen units (the 0.8 by 0.6 frame space) from thousandths. */
const ui = (thousandths: number) => f32(thousandths / 1000);

export interface Picker {
  readonly root: framehandle;
  readonly title: framehandle;
  readonly choices: readonly framehandle[];
  readonly back: framehandle;
}

function at(frame: framehandle, box: Box): framehandle {
  BlzFrameSetAbsPoint(frame, FRAMEPOINT_BOTTOMLEFT, ui(box.left), ui(box.bottom));
  BlzFrameSetSize(frame, ui(box.width), ui(box.height));
  return frame;
}

function dialogButton(parent: framehandle, context: number, box: Box, clicks: trigger): framehandle {
  const button = at(BlzCreateFrameByType("GLUETEXTBUTTON", "RpsPickerButton", parent, "ScriptDialogButton", context), box);
  BlzTriggerRegisterFrameEvent(clicks, button, FRAMEEVENT_CONTROL_CLICK);
  return button;
}

/** Creates one player's picker; its buttons register their clicks on `clicks`. */
export function createPicker(context: number, clicks: trigger): Picker {
  const root = BlzCreateFrameByType("FRAME", "RpsPicker", BlzGetOriginFrame(ORIGIN_FRAME_GAME_UI, 0), "", context);
  const panel = at(BlzCreateFrameByType("BACKDROP", "RpsPickerPanel", root, "", context), PICKER_PANEL);
  BlzFrameSetTexture(panel, "Textures\\Black32.blp", 0, true);
  BlzFrameSetAlpha(panel, 200);
  BlzFrameSetEnable(panel, false);
  const title = at(BlzCreateFrameByType("TEXT", "RpsPickerTitle", root, "", context), PICKER_TITLE);
  BlzFrameSetTextAlignment(title, TEXT_JUSTIFY_MIDDLE, TEXT_JUSTIFY_CENTER);
  BlzFrameSetEnable(title, false);
  const choices: framehandle[] = [];
  for (let index = 0; index < PICKER_CHOICES; index++) choices.push(dialogButton(root, context, pickerChoice(index), clicks));
  const back = dialogButton(root, context, PICKER_BACK, clicks);
  BlzFrameSetText(back, "Back");
  return { root, title, choices, back };
}

/** Shows the title, the four choices' labels and whether Back is offered. */
export function showPicker(picker: Picker, title: string, labels: readonly string[], back: boolean): void {
  BlzFrameSetText(picker.title, title);
  picker.choices.forEach((choice, index) => BlzFrameSetText(choice, labels[index] ?? ""));
  BlzFrameSetVisible(picker.back, back);
}

/** What a clicked frame (by handle id) picks: a choice's index, "back", or nothing of this picker. */
export function pickerAction(picker: Picker, clickedId: number): number | "back" | undefined {
  if (GetHandleId(picker.back) === clickedId) return "back";
  const index = picker.choices.findIndex((choice) => GetHandleId(choice) === clickedId);
  return index < 0 ? undefined : index;
}
