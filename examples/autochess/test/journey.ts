// The autochess headless journey, declared once for Bun and 32-bit Lua:
// round 1's shop, a -shop chat, a hot reload, a -traits chat and four rounds
// with empty boards (shop buttons need a click in Warcraft): three against
// creeps, which cost health, then round 4 against the other player's board.
import type { Journey } from "wisp/src/headless/journey";

const SHOP = "the journey checks rounds and messages; shop buttons need a click in Warcraft";
const LOOKS = "the journey checks rounds and messages, not what players see";
const FIGHTS = "headless units don't fight; with empty boards each fight ends on its first tick";

/** What a headless run needs to know about the map: src/main.ts's configureRuntime() prefixes. */
export const CHESS_MAP = {
  filePrefix: "autochess", globalPrefixes: ["__chess"],
  // The playable rectangle is centered at the origin.
  natives: () => ({ GetRectCenterX: () => 0, GetRectCenterY: () => 0 }),
  localNatives: { PanCameraToTimed: "moves only this player's camera, to their own board" },
  intentionalNoops: {
    DialogCreate: SHOP, DialogClear: SHOP, DialogSetMessage: SHOP, DialogAddButton: SHOP, DialogDisplay: SHOP, TriggerRegisterDialogEvent: SHOP,
    PanCameraToTimed: LOOKS, FogEnable: LOOKS, FogMaskEnable: LOOKS, SetPlayerColor: LOOKS, GetPlayerColor: LOOKS,
    CreateMultiboard: LOOKS, MultiboardSetColumnCount: LOOKS, MultiboardSetRowCount: LOOKS, MultiboardSetTitleText: LOOKS,
    MultiboardGetItem: LOOKS, MultiboardSetItemStyle: LOOKS, MultiboardSetItemValue: LOOKS, MultiboardSetItemWidth: LOOKS,
    MultiboardReleaseItem: LOOKS, MultiboardDisplay: LOOKS,
    SetPlayerState: "the gold display mirrors the map's own gold, which the journey checks through messages",
    SetPlayerAlliance: FIGHTS, IssuePointOrder: FIGHTS,
    IsUnitType: "nobody dies headless: every unit reads as alive",
  },
};

/** 60 frames a second; each round is 30 s of shopping and a fight that ends at once. */
export const CHESS_JOURNEY: Journey = {
  frames: 7800,
  events: [
    { frame: 60, player: 0, chat: "-shop" },
    { frame: 600, reload: true },
    { frame: 900, player: 1, chat: "-traits" },
    { frame: 2400, player: 1, chat: "-shop" },
  ],
};
