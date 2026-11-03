// A neutral town around the riders' lap: shops around the plaza, a ring of
// farms and guard towers at its corners. Offsets are integers, so every
// client places the same buildings.

const CASTLE = 0x68636173; // hcas
const BARRACKS = 0x68626172; // hbar
const BLACKSMITH = 0x68626c61; // hbla
const LUMBER_MILL = 0x686c756d; // hlum
const ALTAR = 0x68616c74; // halt
const SANCTUM = 0x68617273; // hars
const WORKSHOP = 0x6861726d; // harm
const AVIARY = 0x68677261; // hgra
const FARM = 0x68686f75; // hhou
const GUARD_TOWER = 0x68677477; // hgtw
const VILLAGER = 1853253996; // nvil; in hex the rule TS9300 reads its "e" as an exponent

/** Half the side of the shop square, outside the lap's 512. */
const SHOPS = 1024;
/** Half the side of the farm ring, a whole number of farm steps. */
const RING = 1536;
/** Distance between farms along the ring. */
const FARM_STEP = 384;

const SHOP_PLAN: readonly (readonly [id: number, x: number, y: number])[] = [
  [CASTLE, 0, SHOPS],
  [BARRACKS, -SHOPS, SHOPS],
  [BLACKSMITH, SHOPS, SHOPS],
  [WORKSHOP, -SHOPS, 0],
  [AVIARY, SHOPS, 0],
  [LUMBER_MILL, -SHOPS, -SHOPS],
  [ALTAR, 0, -SHOPS],
  [SANCTUM, SHOPS, -SHOPS],
];

const VILLAGERS: readonly (readonly [x: number, y: number])[] = [
  [-192, 128], [160, 224], [-64, -192], [256, -96], [32, 32], [-288, -256],
];

export function buildCity(this: void, centerX: number, centerY: number): void {
  const town = Player(PLAYER_NEUTRAL_PASSIVE);
  const place = (id: number, x: number, y: number, facing: number) => CreateUnit(town, id, centerX + x, centerY + y, facing);
  for (const [id, x, y] of SHOP_PLAN) place(id, x, y, 270.0);
  for (let along = -RING; along <= RING; along += FARM_STEP) {
    const corner = along === -RING || along === RING;
    place(corner ? GUARD_TOWER : FARM, along, RING, 270.0);
    place(corner ? GUARD_TOWER : FARM, along, -RING, 270.0);
    if (corner) continue;
    place(FARM, -RING, along, 270.0);
    place(FARM, RING, along, 270.0);
  }
  for (const [x, y] of VILLAGERS) place(VILLAGER, x, y, 270.0);
}
