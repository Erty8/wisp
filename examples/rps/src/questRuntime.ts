// The quest engine: what a scene's fights, turns and allies do once they are
// in the world. A `fight` effect raises enemies (held for the scene's end, or
// standing guard at the scene's objective, marked on the player's minimap); a
// `hostile` effect turns the NPC or his company; an `ally` effect sides them
// with the hero; and every unit is filed under its tag for the player, whose
// bounty pays once all of them have fallen (`questTick`). Its state lives in
// the map's state global (./sceneHost.ts).
import { floorDiv } from "wisp/src/sim/intMath";
import { atan2Tenths } from "./combat";
import { type Bounty, type Effect, type Scene, objectiveSpot } from "./dialogue";
import { type Point, offset } from "./rules";
import {
  CAMP_DISTANCE, CAMP_RADIUS, FIGHT_DISTANCE, OBJECTIVE_ICON_FILE, OBJECTIVE_ICON_SKIN_KEY, OBJECTIVE_PING_SECONDS, OBJECTIVE_RADIUS, SITE_RADIUS,
} from "./constants";
import { type SceneRun, type SceneSeat, alive, flagsOf, goldOf, isLocal, now, pointOf, rawcode, say, scenes } from "./sceneHost";

/** The NPC himself, or his company of one unit type (`code`), for a `hostile` or `ally` effect. */
function castOf(run: SceneRun, code: string | undefined): unit[] {
  const company = scenes().npcs.find((npc) => npc.unit === run.npc)?.extras ?? [];
  return code === undefined ? [run.npc] : company.filter((unit) => alive(unit) && GetUnitTypeId(unit) === rawcode(code));
}

/** An `ally` effect: the NPC, or his company of one unit type, joins the hero as the scene ends (`releaseScene`). */
export function enlist(run: SceneRun, effect: Extract<Effect, { kind: "ally" }>): void {
  for (const unit of castOf(run, effect.code)) run.allies.push({ unit, tag: effect.tag });
}

/** A `hostile` effect: the NPC, or his company of one unit type, turns as the scene ends (`releaseScene`). */
export function turn(seat: SceneSeat, run: SceneRun, effect: Extract<Effect, { kind: "hostile" }>): void {
  for (const unit of castOf(run, effect.code)) run.turns.push({ unit, tag: effect.tag, hold: effect.hold ?? 0 });
  if (effect.bounty !== undefined) addBounty(seat, effect.tag, effect.bounty);
}

/**
 * A `fight` effect: behind the hero, up the road; around the NPC's site; or
 * at a camp past it, away from the map's center: held until the scene ends,
 * then coming for him. At the scene's objective they stand guard there instead.
 */
export function raiseFight(seat: SceneSeat, run: SceneRun, effect: Extract<Effect, { kind: "fight" }>): void {
  const hero = pointOf(seat.hero);
  const npc = pointOf(run.npc);
  const away = atan2Tenths(hero.y - npc.y, hero.x - npc.x);
  const outward = atan2Tenths(npc.y - scenes().center.y, npc.x - scenes().center.x);
  const camp = offset(npc.x, npc.y, outward, CAMP_DISTANCE, 0);
  const objective = effect.at === "objective" ? objectivePoint(run.scene) : undefined;
  for (let index = 0; index < effect.count; index++) {
    const around = floorDiv(index * 3600, effect.count);
    const spot = objective !== undefined ? offset(objective.x, objective.y, around, OBJECTIVE_RADIUS, 0)
      : effect.at === "site" ? offset(npc.x, npc.y, around, SITE_RADIUS, 0)
      : effect.at === "camp" ? offset(camp.x, camp.y, around, CAMP_RADIUS, 0)
      : offset(hero.x, hero.y, away, FIGHT_DISTANCE, (index * 2 - effect.count + 1) * 90);
    const enemy = CreateUnit(Player(PLAYER_NEUTRAL_AGGRESSIVE), rawcode(effect.code), spot.x, spot.y, atan2Tenths(hero.y - spot.y, hero.x - spot.x) / 10);
    if (objective === undefined) {
      PauseUnit(enemy, true);
      run.paused.push(enemy);
      run.fights.push(enemy);
    }
    if (effect.tag !== undefined) tagUnit(seat, effect.tag, enemy);
  }
  if (objective !== undefined && effect.tag !== undefined) markObjective(seat, effect.tag, objective, run.scene.objective?.name ?? "the objective");
  if (effect.tag !== undefined && effect.bounty !== undefined) addBounty(seat, effect.tag, effect.bounty);
}

/** Where a scene's objective stands on this map (`objectiveSpot`), or undefined for a scene without one. */
function objectivePoint(scene: Scene): Point | undefined {
  if (scene.objective === undefined) return undefined;
  const area = bj_mapInitialPlayableArea;
  return objectiveSpot(scenes().center, scene.objective, {
    minX: Math.floor(GetRectMinX(area)), minY: Math.floor(GetRectMinY(area)), maxX: Math.floor(GetRectMaxX(area)), maxY: Math.floor(GetRectMaxY(area)),
  });
}

/**
 * Marks a quest's objective on this player's minimap, once per tag: Warcraft's
 * quest objective icon, which every client makes and only he sees, a ping
 * there on his minimap, and a message naming the place. `questTick` takes the
 * icon down once every unit under the tag has fallen.
 */
function markObjective(seat: SceneSeat, tag: string, spot: Point, name: string): void {
  const state = scenes();
  const marks = state.objectives ?? [];
  state.objectives = marks;
  const key = `${seat.id}:${tag}`;
  if (marks.some((mark) => mark.key === key)) return;
  const skinned = SkinManagerGetLocalPath(OBJECTIVE_ICON_SKIN_KEY);
  const icon = CreateMinimapIcon(spot.x, spot.y, 255, 220, 0, skinned === "" ? OBJECTIVE_ICON_FILE : skinned, FOG_OF_WAR_MASKED);
  SetMinimapIconVisible(icon, false);
  if (isLocal(seat)) {
    SetMinimapIconVisible(icon, true);
    PingMinimapEx(spot.x, spot.y, OBJECTIVE_PING_SECONDS, 255, 220, 0, false);
  }
  marks.push({ key, icon });
  say(seat, `${name.charAt(0).toUpperCase()}${name.slice(1)} is marked on your map.`);
}

/** Files a unit a scene raised or turned under its tag, for this player. */
function tagUnit(seat: SceneSeat, tag: string, unit: unit): void {
  const state = scenes();
  const tagged = state.tagged ?? new Map<string, unit[]>();
  state.tagged = tagged;
  const key = `${seat.id}:${tag}`;
  const units = tagged.get(key) ?? [];
  units.push(unit);
  tagged.set(key, units);
}

/** A bounty for this player on a tag, once: it pays when every unit under the tag has fallen (`questTick`). */
function addBounty(seat: SceneSeat, tag: string, bounty: Bounty): void {
  const state = scenes();
  const bounties = state.bounties ?? [];
  state.bounties = bounties;
  const key = `${seat.id}:${tag}`;
  if (!bounties.some((entry) => entry.key === key)) bounties.push({ seat: seat.id, key, bounty });
}

/**
 * As a scene finishes: any enemies it raised come for the hero; those it
 * turned join the hostile creeps, can be hurt, and come for him, dazed a while
 * first if held; those who promised to help join his side, can't be hurt, and
 * go at the enemy (`questTick` sends them home after): with an objective they
 * set out for it, without one they go at his foes where he stands.
 */
export function releaseScene(seat: SceneSeat, run: SceneRun): void {
  for (const enemy of run.fights) IssueTargetOrder(enemy, "attack", seat.hero);
  const rally = run.allies.length > 0 ? objectivePoint(run.scene) ?? pointOf(seat.hero) : undefined;
  for (const ally of run.allies) {
    const allies = scenes().allies ?? [];
    allies.push({ unit: ally.unit, key: `${seat.id}:${ally.tag}`, post: pointOf(ally.unit) });
    scenes().allies = allies;
    SetUnitOwner(ally.unit, seat.player, false);
    if (rally !== undefined) IssuePointOrder(ally.unit, "attack", rally.x, rally.y);
  }
  for (const turned of run.turns) {
    SetUnitInvulnerable(turned.unit, false);
    SetUnitOwner(turned.unit, Player(PLAYER_NEUTRAL_AGGRESSIVE), true);
    tagUnit(seat, turned.tag, turned.unit);
    if (turned.hold <= 0) IssueTargetOrder(turned.unit, "attack", seat.hero);
    else {
      PauseUnit(turned.unit, true);
      const held = scenes().held ?? [];
      held.push({ unit: turned.unit, until: now() + floorDiv(turned.hold * 100, 3), seat: seat.id });
      scenes().held = held;
    }
  }
}

/**
 * Every 0.5 s: turned units whose daze is over come for their hero; allies
 * whose fight is won go back to their post, neutral again; objectives whose
 * fight is won leave the minimap; and a bounty whose tag's units have all
 * fallen pays its gold, sets its flag and tells its player.
 */
export function questTick(): void {
  const state = scenes();
  const tick = now();
  const held = state.held ?? [];
  state.held = held.filter((entry) => {
    if (tick < entry.until) return true;
    const seat = state.seats.find((candidate) => candidate.id === entry.seat);
    PauseUnit(entry.unit, false);
    if (seat !== undefined && alive(entry.unit)) IssueTargetOrder(entry.unit, "attack", seat.hero);
    return false;
  });
  const won = (key: string) => {
    const units = state.tagged?.get(key) ?? [];
    return units.length > 0 && !units.some((unit) => alive(unit));
  };
  const allies = state.allies ?? [];
  state.allies = allies.filter((entry) => {
    if (!won(entry.key)) return true;
    SetUnitOwner(entry.unit, Player(PLAYER_NEUTRAL_PASSIVE), false);
    IssuePointOrder(entry.unit, "move", entry.post.x, entry.post.y);
    return false;
  });
  const objectives = state.objectives ?? [];
  state.objectives = objectives.filter((mark) => {
    if (!won(mark.key)) return true;
    DestroyMinimapIcon(mark.icon);
    return false;
  });
  const bounties = state.bounties ?? [];
  state.bounties = bounties.filter((entry) => {
    const units = state.tagged?.get(entry.key) ?? [];
    if (units.length === 0 || units.some((unit) => alive(unit))) return true;
    const seat = state.seats.find((candidate) => candidate.id === entry.seat);
    if (seat === undefined) return false;
    SetPlayerState(seat.player, PLAYER_STATE_RESOURCE_GOLD, goldOf(seat) + entry.bounty.gold);
    if (entry.bounty.flag !== undefined) flagsOf(seat).add(entry.bounty.flag);
    say(seat, entry.bounty.text);
    return false;
  });
}
