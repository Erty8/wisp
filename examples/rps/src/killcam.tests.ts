import { assertEquals, test } from "wisp/src/runtime/testing";
import { KILL_CAM_BLEND, KILL_CAM_CLOSE, KILL_CAM_TICKS, endsFight, killCamShot, killCamWeight, mix } from "./killcam";

test("rps kill cam: a death near the hero ends his fight only when no enemy is left within 900", () => {
  const hero = { x: 0, y: 0 };
  assertEquals(endsFight(hero, { x: 0, y: 200 }, []), true, "the last one");
  assertEquals(endsFight(hero, { x: 0, y: 200 }, [{ x: 0, y: 900 }]), false, "one more at 900");
  assertEquals(endsFight(hero, { x: 0, y: 200 }, [{ x: 0, y: 901 }]), true, "the next one is too far to count");
  assertEquals(endsFight(hero, { x: 0, y: 901 }, []), false, "a death too far from the hero");
});

test("rps kill cam: the shot glides in over 12 ticks, holds, and glides back by its end", () => {
  assertEquals(killCamWeight(0), 0, "the start");
  assertEquals(killCamWeight(KILL_CAM_BLEND / 2), 50, "halfway in");
  assertEquals(killCamWeight(KILL_CAM_BLEND), 100, "in");
  assertEquals(killCamWeight(KILL_CAM_TICKS / 2), 100, "holding");
  assertEquals(killCamWeight(KILL_CAM_TICKS - KILL_CAM_BLEND / 2), 50, "halfway back");
  assertEquals(killCamWeight(KILL_CAM_TICKS), 0, "the end");
  assertEquals(killCamWeight(KILL_CAM_TICKS + 5), 0, "after it");
});

test("[property] rps kill cam: the glide in never steps backward", () => {
  for (let tick = 1; tick <= KILL_CAM_BLEND; tick++) assertEquals(killCamWeight(tick) >= killCamWeight(tick - 1), true, `tick ${tick}`);
});

test("rps kill cam: held, the camera looks at the fallen enemy close and low; at either end, at the hero as the player left it", () => {
  const base = { distance: 650, attack: -180, fieldOfView: 75, zOffset: 120 };
  const hero = { x: 100, y: 100 }, fallen = { x: 400, y: -200 };
  const held = killCamShot(base, 900, hero, fallen, KILL_CAM_TICKS / 2);
  assertEquals(`${held.focus.x},${held.focus.y},${held.yaw}`, "300,-300,1050", "on the fallen, turned 15 degrees");
  assertEquals(`${held.distance},${held.attack},${held.fieldOfView},${held.zOffset}`, `${KILL_CAM_CLOSE.distance},${KILL_CAM_CLOSE.attack},${KILL_CAM_CLOSE.fieldOfView},${KILL_CAM_CLOSE.zOffset}`, "the close view");
  const start = killCamShot(base, 900, hero, fallen, 0);
  assertEquals(`${start.focus.x},${start.focus.y},${start.yaw},${start.distance}`, "0,0,900,650", "the player's own camera");
  assertEquals(mix(650, 380, 50), 515, "halfway between");
});
