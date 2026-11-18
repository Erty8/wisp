// What a personal scene shows over the game: the line as plain text, the
// speaker's name in gold over it, centered low on the screen, with no panel or
// portrait; up to four choice buttons in Warcraft's dialog style, stacked at
// the right above it and shown only on lines that branch (greyed out when the
// player can't take them); and a black screen the scene fades in from and out
// to. Warcraft's cinematic mode isn't used: it took the cursor, keys and clicks
// the scene needs. The frames hang off the world frame. Every client creates and fills
// every player's the same way; the caller shows each player only their own.
import { f32 } from "wisp/src/sim/f32";
import { type Box, FADE_BOX, SCENE_CHOICES, SUBTITLE, sceneChoice } from "./layout";

/** Screen units (the 0.8 by 0.6 frame space) from thousandths. */
const ui = (thousandths: number) => f32(thousandths / 1000);
/** The line's text a little larger than Warcraft's default. */
const SUBTITLE_SCALE = f32(1.25);

export interface Letterbox {
  readonly root: framehandle;
  /** The line: the speaker's name over it. */
  readonly subtitle: framehandle;
  readonly choices: readonly framehandle[];
  /** The black the scene fades through. */
  readonly fade: framehandle;
}

/** A choice as it shows: its text, and whether it is greyed out or hidden. */
export interface ChoiceView {
  readonly text: string;
  readonly state: "open" | "greyed" | "hidden";
}

function at(frame: framehandle, box: Box): framehandle {
  BlzFrameSetAbsPoint(frame, FRAMEPOINT_BOTTOMLEFT, ui(box.left), ui(box.bottom));
  BlzFrameSetSize(frame, ui(box.width), ui(box.height));
  return frame;
}

/** Creates one player's scene frames, hidden; the choice buttons register their clicks on `clicks`. */
export function createLetterbox(context: number, clicks: trigger): Letterbox {
  const world = BlzGetOriginFrame(ORIGIN_FRAME_WORLD_FRAME, 0);
  const root = BlzCreateFrameByType("FRAME", "RpsLetterbox", world, "", context);
  const subtitle = at(BlzCreateFrameByType("TEXT", "RpsSubtitle", root, "", context), SUBTITLE);
  BlzFrameSetTextAlignment(subtitle, TEXT_JUSTIFY_BOTTOM, TEXT_JUSTIFY_CENTER);
  BlzFrameSetScale(subtitle, SUBTITLE_SCALE);
  BlzFrameSetEnable(subtitle, false);
  const choices: framehandle[] = [];
  for (let index = 0; index < SCENE_CHOICES; index++) {
    const choice = at(BlzCreateFrameByType("GLUETEXTBUTTON", "RpsSceneChoice", root, "ScriptDialogButton", context), sceneChoice(index));
    BlzTriggerRegisterFrameEvent(clicks, choice, FRAMEEVENT_CONTROL_CLICK);
    choices.push(choice);
  }
  BlzFrameSetVisible(root, false);
  const fade = at(BlzCreateFrameByType("BACKDROP", "RpsSceneFade", world, "", context), FADE_BOX);
  BlzFrameSetTexture(fade, "Textures\\Black32.blp", 0, true);
  BlzFrameSetEnable(fade, false);
  BlzFrameSetVisible(fade, false);
  return { root, subtitle, choices, fade };
}

/** Shows a line: the speaker's name in gold, and his line under it; an empty name clears it. */
export function showSubtitle(letterbox: Letterbox, speaker: string, text: string): void {
  BlzFrameSetText(letterbox.subtitle, speaker === "" ? "" : `|cffffcc00${speaker}|r|n${text}`);
}

/** Shows a line's choices numbered 1 to 4, a greyed one disabled; hidden ones and the unused buttons hide. */
export function showChoices(letterbox: Letterbox, choices: readonly ChoiceView[]): void {
  letterbox.choices.forEach((button, index) => {
    const choice = choices[index];
    const shown = choice !== undefined && choice.state !== "hidden";
    BlzFrameSetVisible(button, shown);
    if (choice === undefined || !shown) return;
    BlzFrameSetText(button, choice.state === "greyed" ? `|cff808080${index + 1}. ${choice.text}|r` : `${index + 1}. ${choice.text}`);
    BlzFrameSetEnable(button, choice.state === "open");
  });
}

/** Sets the black's opacity, 0 to 255, hiding it at 0 (local: this player's own screen). */
export function setFade(letterbox: Letterbox, alpha: number): void {
  BlzFrameSetVisible(letterbox.fade, alpha > 0);
  BlzFrameSetAlpha(letterbox.fade, alpha);
}

/** Which choice a clicked frame (by handle id) is, or undefined. */
export function choiceOf(letterbox: Letterbox, clickedId: number): number | undefined {
  const index = letterbox.choices.findIndex((button) => GetHandleId(button) === clickedId);
  return index < 0 ? undefined : index;
}
