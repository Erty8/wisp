import { assertEquals, test } from "wisp/src/runtime/testing";
import { type Hero, DEFAULT_PICK, HERO_LISTS, RACES, TAVERN_HEROES, heroList, heroListNames, heroOf, raceOf } from "./roster";

/** Every hero a player can pick: the races' and the taverns'. */
function allHeroes(): Hero[] {
  const heroes: Hero[] = [];
  for (const race of RACES) heroes.push(...race.heroes);
  heroes.push(...TAVERN_HEROES);
  return heroes;
}

test("[property] rps roster: four races of four heroes and eight tavern heroes, each with four distinct skills that cast unless passive, and an army of two melee and two ranged soldiers", () => {
  assertEquals(RACES.length, 4, "races");
  assertEquals(TAVERN_HEROES.length, 8, "tavern heroes");
  const codes = new Set<string>();
  for (const race of RACES) {
    assertEquals(race.heroes.length, 4, `${race.name} heroes`);
    assertEquals(race.army.filter((soldier) => soldier.role === "melee").length, 2, `${race.name} melee`);
    assertEquals(race.army.filter((soldier) => soldier.role === "ranged").length, 2, `${race.name} ranged`);
    for (const soldier of race.army) assertEquals(soldier.plural.length > 0, true, `${soldier.code} plural`);
    assertEquals(race.veterans.filter((soldier) => soldier.role === "melee").length, 2, `${race.name} veteran melee`);
    assertEquals(race.veterans.filter((soldier) => soldier.role === "ranged").length, 2, `${race.name} veteran ranged`);
  }
  for (const hero of allHeroes()) {
    assertEquals(hero.code.length, 4, `${hero.name} code`);
    assertEquals(new Set(hero.skills.map((skill) => skill.code)).size, 4, `${hero.name} distinct skills`);
    for (const skill of hero.skills) {
      assertEquals(skill.code.length, 4, `${skill.name} code`);
      assertEquals(skill.targeting === "passive" ? skill.order === "" : skill.order !== "", true, `${skill.name} has an order unless passive`);
      codes.add(skill.code);
    }
  }
  assertEquals(codes.size, 96, "no skill shared between heroes");
});

test("rps roster: a pick out of range falls back to the default, the Human Mountain King", () => {
  assertEquals(heroOf(1, 2).name, "Tauren Chieftain", "Orc, third hero");
  assertEquals(heroOf(9, 9).name, "Mountain King", "out of range");
  assertEquals(raceOf(3).name, "Undead", "fourth race");
  assertEquals(heroOf(DEFAULT_PICK.race, DEFAULT_PICK.hero).skills[0].name, "Storm Bolt", "default");
});

test("rps roster: the eleven ranged heroes attack with Warcraft's own attack, the thirteen melee heroes swing", () => {
  const ranged: string[] = [];
  for (const hero of allHeroes()) if (hero.ranged === true) ranged.push(hero.name);
  assertEquals(ranged.join(", "), "Archmage, Blood Mage, Far Seer, Shadow Hunter, Keeper of the Grove, Priestess of the Moon, Lich, Naga Sea Witch, Dark Ranger, Goblin Tinker, Firelord", "ranged");
});

test("rps roster: a player picks from his race's heroes or one of two pages of tavern heroes, four each", () => {
  assertEquals(heroListNames(1).join(", "), "Orc heroes, Tavern heroes, More tavern heroes", "an Orc's lists");
  assertEquals(heroListNames(1).length, HERO_LISTS, "one name per list");
  assertEquals(heroList(1, 0).map((hero) => hero.name).join(", "), "Blademaster, Far Seer, Tauren Chieftain, Shadow Hunter", "his race's");
  assertEquals(heroList(1, 1).map((hero) => hero.name).join(", "), "Naga Sea Witch, Dark Ranger, Pandaren Brewmaster, Beastmaster", "the first tavern page");
  assertEquals(heroList(3, 2).map((hero) => hero.name).join(", "), "Pit Lord, Goblin Tinker, Firelord, Goblin Alchemist", "the second, the same for any race");
  assertEquals(heroList(0, 3).length, 0, "no fourth list");
});
