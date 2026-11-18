// The autochess headless journey, declared once for Bun and 32-bit Lua:
// round 1's shop, where player 1 clicks the first offer and buys it, a
// -shop chat, a hot reload, a -traits chat and four rounds with empty boards
// (moving units needs Warcraft's orders): three against creeps, which cost
// health, then round 4 against the other player's board.
import type { Journey } from "wisp/src/headless/journey";

const LOOKS = "the journey checks rounds and messages, not what players see";
const FIGHTS = "headless units don't fight; with empty boards each fight ends on its first tick";
const ORDERS = "headless units take no orders, so pieces are never moved";

/** What a headless run needs to know about the map: src/main.ts's configureRuntime() prefixes. */
export const CHESS_MAP = {
  filePrefix: "autochess", globalPrefixes: ["__chess"],
  // The playable rectangle is centered at the origin.
  natives: () => ({ GetRectCenterX: () => 0, GetRectCenterY: () => 0 }),
  localNatives: {
    PanCameraToTimed: "moves only this player's camera, to their own board",
    BlzFrameSetVisible: "shows each player only their own shop panel; every client makes and fills all of them",
  },
  intentionalNoops: {
    PanCameraToTimed: LOOKS, FogEnable: LOOKS, FogMaskEnable: LOOKS, SetPlayerColor: LOOKS, GetPlayerColor: LOOKS,
    CreateMultiboard: LOOKS, MultiboardSetColumnCount: LOOKS, MultiboardSetRowCount: LOOKS, MultiboardSetTitleText: LOOKS,
    MultiboardGetItem: LOOKS, MultiboardSetItemStyle: LOOKS, MultiboardSetItemValue: LOOKS, MultiboardSetItemWidth: LOOKS,
    MultiboardReleaseItem: LOOKS, MultiboardDisplay: LOOKS,
    SetPlayerState: "the gold display mirrors the map's own gold, which the journey checks through messages",
    SetPlayerAlliance: FIGHTS, IssuePointOrder: FIGHTS,
    IsUnitType: "nobody dies headless: every unit reads as alive",
    SetUnitInvulnerable: "only shelf units are invulnerable, and headless nothing attacks them",
    TriggerRegisterPlayerUnitEvent: ORDERS, Filter: ORDERS,
  },
};

/** Inside player 1's first shop slot, which spans x 0.13 to 0.22 and y 0.39 to 0.54 of the 0.8 by 0.6 screen. */
const FIRST_OFFER = { x: 0.171875, y: 0.46875 };

/** 60 frames a second; each round is 30 s of shopping, a fight that ends at once and 3 s of aftermath. */
export const CHESS_JOURNEY: Journey = {
  frames: 8100,
  events: [
    { frame: 120, player: 0, click: FIRST_OFFER },
    { frame: 300, player: 1, chat: "-shop" },
    { frame: 600, reload: true },
    { frame: 900, player: 1, chat: "-traits" },
  ],
};
