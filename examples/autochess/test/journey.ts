// The autochess headless journey, declared once for Bun and 32-bit Lua:
// round 1's shop, a -shop chat, a hot reload, the round 1 fight until its
// timeout (headless units don't fight) and round 2's shop.
import type { Journey } from "wisp/src/headless/journey";

/** What a headless run needs to know about the map: src/main.ts's configureRuntime() prefixes. */
export const CHESS_MAP = {
  filePrefix: "autochess", globalPrefixes: ["__chess"],
  // The playable rectangle is centered at the origin.
  natives: () => ({ GetRectCenterX: () => 0, GetRectCenterY: () => 0 }),
  localNatives: { PanCameraToTimed: "moves only this player's camera, to their own board" },
  intentionalNoops: {
    DialogCreate: "the journey checks rounds and messages; shop buttons need a click in Warcraft",
    DialogClear: "the journey checks rounds and messages; shop buttons need a click in Warcraft",
    DialogSetMessage: "the journey checks rounds and messages; shop buttons need a click in Warcraft",
    DialogAddButton: "the journey checks rounds and messages; shop buttons need a click in Warcraft",
    DialogDisplay: "the journey checks rounds and messages; shop buttons need a click in Warcraft",
    TriggerRegisterDialogEvent: "the journey checks rounds and messages; shop buttons need a click in Warcraft",
    PanCameraToTimed: "the journey has no camera",
    FogEnable: "the journey checks rounds and messages, not what players see",
    FogMaskEnable: "the journey checks rounds and messages, not what players see",
    SetPlayerState: "the gold display mirrors the map's own gold, which the journey checks through messages",
    RemoveGuardPosition: "headless creeps don't fight, so the round ends at its timeout",
    SetUnitCreepGuard: "headless creeps don't fight, so the round ends at its timeout",
    UnitAddSleep: "headless creeps don't fight, so the round ends at its timeout",
    IssuePointOrder: "headless units don't fight, so the round ends at its timeout",
    IsUnitType: "nobody dies headless: every unit reads as alive",
  },
};

/** 60 frames a second: 30 s of shopping, then the fight's 60 s timeout. */
export const CHESS_JOURNEY: Journey = {
  frames: 6000,
  events: [
    { frame: 60, player: 0, chat: "-shop" },
    { frame: 600, reload: true },
    { frame: 2400, player: 1, chat: "-shop" },
  ],
};
