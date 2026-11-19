import { assertEquals, test } from "wisp/src/runtime/testing";
import { SUBTITLE, sceneChoice, LIFE_BAR, MANA_BAR, MINIMAP, PICKER_PANEL, QUEST_LOG, SCREEN_HEIGHT, SCREEN_WIDTH, layoutBoxes, learnButton, overlaps, pickerBoxes, spellSlot } from "./layout";

test("[property] rps layout: the quest journal sits at the right edge under the minimap, clear of every other box and a scene's choices", () => {
  assertEquals(QUEST_LOG.left + QUEST_LOG.width, MINIMAP.left + MINIMAP.width, "right edge with the minimap");
  assertEquals(QUEST_LOG.bottom + QUEST_LOG.height < MINIMAP.bottom && QUEST_LOG.bottom > 0, true, "under the minimap, on screen");
  for (const { name, box } of layoutBoxes()) assertEquals(overlaps(QUEST_LOG, box), false, name);
  for (let index = 0; index < 4; index++) assertEquals(overlaps(QUEST_LOG, sceneChoice(index)), false, `choice ${index}`);
});

test("[property] rps layout: the bars and the spell bar stay on screen in the bottom quarter, the minimap at the top, and none overlap", () => {
  const boxes = layoutBoxes();
  for (const { name, box } of boxes) {
    assertEquals(box.left >= 0 && box.bottom >= 0 && box.left + box.width <= SCREEN_WIDTH && box.bottom + box.height <= SCREEN_HEIGHT, true, `${name} on screen`);
    assertEquals(name === "minimap" ? box.bottom >= 450 : box.bottom + box.height <= 150, true, `${name} keeps to its quarter`);
  }
  for (let one = 0; one < boxes.length; one++) {
    for (let other = one + 1; other < boxes.length; other++) {
      const a = boxes[one], b = boxes[other];
      if (a === undefined || b === undefined) continue;
      assertEquals(overlaps(a.box, b.box), false, `${a.name} and ${b.name}`);
    }
  }
});

test("rps layout: the mana bar sits under the health bar in the bottom-left corner", () => {
  assertEquals(MANA_BAR.bottom + MANA_BAR.height <= LIFE_BAR.bottom, true, "stacked");
  assertEquals(LIFE_BAR.left === MANA_BAR.left && LIFE_BAR.width === MANA_BAR.width, true, "aligned");
});

test("rps layout: the minimap sits in the top-right corner of the 4:3 frame space, 5 in from its edges", () => {
  assertEquals(`${MINIMAP.left + MINIMAP.width},${MINIMAP.bottom + MINIMAP.height}`, `${SCREEN_WIDTH - 5},${SCREEN_HEIGHT - 5}`, "the corner");
});

test("rps layout: the spell bar's 4 slots sit centered at the bottom, each with its learn button above it", () => {
  const first = spellSlot(0), last = spellSlot(3);
  assertEquals(first.left + last.left + last.width, 800, "centered");
  assertEquals(`${first.left},${first.bottom},${first.width}`, "311,18,40", "first slot");
  const learn = learnButton(0);
  assertEquals(learn.bottom > first.bottom + first.height && learn.left > first.left && learn.left + learn.width < first.left + first.width, true, "above, within the slot's width");
});

test("[property] rps layout: the picker's title, choices and back button sit inside its panel and apart", () => {
  const boxes = pickerBoxes();
  const inside = (box: { left: number; bottom: number; width: number; height: number }) =>
    box.left >= PICKER_PANEL.left && box.bottom >= PICKER_PANEL.bottom
    && box.left + box.width <= PICKER_PANEL.left + PICKER_PANEL.width && box.bottom + box.height <= PICKER_PANEL.bottom + PICKER_PANEL.height;
  for (const { name, box } of boxes) assertEquals(inside(box), true, `${name} inside`);
  for (let one = 0; one < boxes.length; one++) {
    for (let other = one + 1; other < boxes.length; other++) {
      const a = boxes[one], b = boxes[other];
      if (a === undefined || b === undefined) continue;
      assertEquals(overlaps(a.box, b.box), false, `${a.name} and ${b.name}`);
    }
  }
});

test("rps layout: a scene's line sits centered low on the screen, and its choices stack at the right above it, apart", () => {
  for (let index = 0; index < 4; index++) {
    const choice = sceneChoice(index);
    assertEquals(choice.bottom > SUBTITLE.bottom + SUBTITLE.height && choice.bottom + choice.height <= 450, true, `choice ${index} above the line, below the top quarter`);
    assertEquals(overlaps(choice, SUBTITLE), false, `choice ${index} clear of the line`);
    assertEquals(choice.left + choice.width <= 800, true, `choice ${index} on screen`);
    if (index > 0) assertEquals(overlaps(choice, sceneChoice(index - 1)), false, `choices ${index - 1} and ${index} apart`);
  }
  assertEquals(sceneChoice(0).bottom > sceneChoice(3).bottom, true, "the first choice on top");
  assertEquals(SUBTITLE.bottom > 0 && SUBTITLE.bottom + SUBTITLE.height <= 150 && SUBTITLE.left + SUBTITLE.width / 2 === 400, true, "the line centered in the bottom quarter");
});
