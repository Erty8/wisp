import { assertEquals, test } from "wisp/src/runtime/testing";
import { DEFAULT_PICK, RACES, heroOf, raceOf } from "./roster";

test("[property] rps roster: four races of four heroes, each with four distinct skills that cast unless passive, and an army of two melee and two ranged soldiers", () => {
  assertEquals(RACES.length, 4, "races");
  const codes = new Set<string>();
  for (const race of RACES) {
    assertEquals(race.heroes.length, 4, `${race.name} heroes`);
    assertEquals(race.army.filter((soldier) => soldier.role === "melee").length, 2, `${race.name} melee`);
    assertEquals(race.army.filter((soldier) => soldier.role === "ranged").length, 2, `${race.name} ranged`);
    for (const soldier of race.army) assertEquals(soldier.plural.length > 0, true, `${soldier.code} plural`);
    for (const hero of race.heroes) {
      assertEquals(hero.code.length, 4, `${hero.name} code`);
      assertEquals(new Set(hero.skills.map((skill) => skill.code)).size, 4, `${hero.name} distinct skills`);
      for (const skill of hero.skills) {
        assertEquals(skill.code.length, 4, `${skill.name} code`);
        assertEquals(skill.targeting === "passive" ? skill.order === "" : skill.order !== "", true, `${skill.name} has an order unless passive`);
        codes.add(skill.code);
      }
    }
  }
  assertEquals(codes.size, 64, "no skill shared between heroes");
});

test("rps roster: a pick out of range falls back to the default, the Human Mountain King", () => {
  assertEquals(heroOf(1, 2).name, "Tauren Chieftain", "Orc, third hero");
  assertEquals(heroOf(9, 9).name, "Mountain King", "out of range");
  assertEquals(raceOf(3).name, "Undead", "fourth race");
  assertEquals(heroOf(DEFAULT_PICK.race, DEFAULT_PICK.hero).skills[0].name, "Storm Bolt", "default");
});

test("rps roster: the seven ranged heroes fire missiles, the nine melee heroes swing", () => {
  const ranged: string[] = [];
  for (const race of RACES) for (const hero of race.heroes) if (hero.missile !== undefined) ranged.push(hero.name);
  assertEquals(ranged.join(", "), "Archmage, Blood Mage, Far Seer, Shadow Hunter, Keeper of the Grove, Priestess of the Moon, Lich", "ranged");
});
