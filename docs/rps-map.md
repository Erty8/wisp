# The RPS example map

[wisp:examples/rps/](../examples/rps/) is a 1999-style role-playing strategy
(RPS) prototype: each player plays the race he chose in Warcraft's lobby,
picks one of its four heroes or one of the eight tavern heroes, starts with
that hero alone, recruits soldiers in dialogues at four race bases (free at
his own race's, paid at the others') and mercenaries from a tavern's
sellsword (a tavern hero's first pair free), and leads them under a
third-person camera the player turns by dragging with the right mouse button,
moves with
WASD relative to that camera, fights with manual swings and a guard that can
parry, soft-targets enemies with Tab and captures outposts for gold. Nothing is ever selected and Warcraft's interface is all
off screen apart from the minimap, in the top-right corner: the map draws its
own health and mana bars, a spell bar to cast and learn from, and a quest
journal at the right under the minimap. It calls Warcraft's natives directly
from TypeScript compiled to Lua, like the [sample map](sample-map.md), and
shares its layout: pure rules in src/rules.ts and src/layout.ts, the entry in
src/main.ts, the combat rules in src/combat.ts, the races, heroes and armies
in src/roster.ts, the picker in src/picker.ts, the interface in src/hud.ts,
dialogue scenes with text-only lines (src/dialogue.ts, src/letterbox.ts)
played by the scene engine (src/scenes.ts, src/questRuntime.ts,
src/sceneHost.ts; see "The scene engine and its host"), the quests'
data and journal (src/quests.ts, src/journal.ts), the kill cam in src/killcam.ts, main.ts's constants in src/constants.ts, and
the same four tsconfigs. Lua lets one function hold at most 200 locals, and
main.ts compiles to one: its top-level functions and constants are each one.
An imported name takes none (the compiled Lua reads it through its module),
so plain constants live in src/constants.ts.

## Picking a hero

Each player's race is the one he chose in Warcraft's own lobby
(`gameRace`: `GetPlayerRace`, where a random race is already settled;
anything else plays as Human). At the start he sees a picker
(src/picker.ts) over his start location, in Warcraft's own dialog buttons:
first his race's heroes or the tavern's ("Human heroes", "Tavern heroes",
"More tavern heroes": `heroListNames`), then the four heroes of that list
(`heroList`), with Back to the lists. A choice without a label is hidden. A
click or the keys 1 to 4 choose, 0 goes back. Clicks and keys reach every
client, so every client spawns the same hero. After 30 seconds
(`PICK_SECONDS`) a player still choosing gets the first hero of the list he
is looking at, or his race's first hero. The hero spawns alone with 150
gold (`STARTING_GOLD`), not on the player's start location:

- A race hero spawns at his race's base (see Race bases), 350 in front of
  its recruiter, toward the map's center (`baseSpawn`): just past talking
  range, with the recruiter's soldiers free to him there. Players of one race
  spawn side by side, each in his own lane 160 apart, by player id.
- A tavern hero belongs to no base: he spawns at the base map's tavern
  nearest his start location (`nearestTavern`), 200 from it toward the
  center and off to the side of the sergeant, in a row of four spots 120
  apart (`tavernSpawn`), where the sellsword gives him his first mercenaries
  free (see Recruiting). A map without a tavern gets a stand-in spot 600
  south of the center, with the sergeant and the sellsword.

A race hero's scenes get his race's flag (`raceFlag`), so his race's base
greets him as kin; a tavern hero's get `TAVERN_HERO_FLAG` instead, so every
base treats him as a stranger. The races' soldiers and veterans:

| Race | Heroes | Soldiers to recruit (two of each, 10 food) |
| --- | --- | --- |
| Human | Paladin, Archmage, Mountain King, Blood Mage | footmen (melee), riflemen (ranged) |
| Orc | Blademaster, Far Seer, Tauren Chieftain, Shadow Hunter | grunts, headhunters |
| Night Elf | Demon Hunter, Keeper of the Grove, Priestess of the Moon, Warden | huntresses, archers |
| Undead | Death Knight, Lich, Dreadlord, Crypt Lord | ghouls, crypt fiends |

The tavern heroes (`TAVERN_HEROES`), in two pages of four: Naga Sea Witch,
Dark Ranger, Pandaren Brewmaster and Beastmaster; Pit Lord, Goblin Tinker,
Firelord and Goblin Alchemist. The Naga Sea Witch, Dark Ranger, Goblin
Tinker and Firelord are ranged (see Ranged). Their sound sets are guesses
(src/units.ts lists likely prefixes for each, and the map asks the game
which one it has), and their skills' rawcodes, order strings and icons are
untested in Warcraft yet. Headless has no lobby: the journey gives both
players Human.

src/roster.ts lists each hero's four skills in learning order (three basic,
then the ultimate) with its rawcode, order string, icon and how the spell bar
casts it (`Targeting`): at the Tab target (`enemy`), on the most hurt squad
member (`ally`, healing and the like), on the hero (`self`), at the Tab
target's spot or 400 ahead along the camera (`point`), at once (`instant`),
or not at all (`passive`). Icons that name a missing file draw as a blank
texture in Warcraft; the roster's icon names are untested there yet.

## Controls

| Key | What it does |
| --- | --- |
| W A S D (held) | Move the hero 250 units at a time relative to the camera; two keys move diagonally, opposite keys cancel. Released, the hero holds his ground. |
| Right mouse button (held, drag) | Turn the camera: dragging across the whole screen turns it a full turn. |
| Left click, Space | Swing, a three-hit combo: at the targeted enemy, the hero turning to face him, or at his own front without a target; the click says when, not where. |
| Q (held) | Guard: a hit from the front in the first 0.24 s is parried, later ones blocked for mana. |
| E | Interact: talk to the nearest NPC within 350, or pick up the nearest item within 200, whichever is nearer (see Items). The hint over the spell bar says which. |
| I, or the Inventory button | Open or close the inventory panel in the bottom-right corner; a click on a slot uses its item. |
| Space, 1 to 4 (in a scene) | Skip a line; choose a reply. |
| `-scene` (chat) | Play the nearest NPC's scene now, wherever the hero is. |
| `-off NAME`, `-on NAME` (chat) | Switch a recent visual part of the map off or back on for every player, from the next time it acts, to find which one changes how something looks: `tint` (the target's red cast), `ring` (its ground ring), `slowmo` (the kill cam's slow motion), `killcam`, `talk` (talk animations and gestures), `fade`, `marks` (the "!" and minimap quest icons), `root` (rooting the idle hero), or `all`. `-off` alone lists them. |
| `-time 12` (chat) | Set the time of day to that hour, 0 to 23 (noon without one), for every player: Warcraft's night light turns shiny armor dark blue and purple, so this shows the map by day and by night. |
| `-anim N`, `-combo A B C`, `-impact N`, `-guard N T` (chat) | Play the hero model's animation N, to find its swings; swing with animations A, B and C (`-combo` alone: the attack animations by name); make swings land N ticks in; guard with animation N frozen T ticks in (`-guard` alone: the combat stance). |
| Tab | Cycle the target through visible enemies within 900 of the hero, nearest first, marked with an overhead effect only its player sees. Without one, the hero targets an enemy on his own. |
| 1, 2, 3, 4 | Cast the hero's first, second and third skill and his ultimate, by its targeting; a passive skill says so. |
| Z | Squad: hold here. The squad stops where it stands and holds position (`holdposition`): it fights what reaches it but follows and chases nothing, until X or C. |
| X | Squad: follow. The squad walks back to its formation around the hero at once, out of any fight (a move order, not an attack-move), and follows him from then on, all of it behind him so none gets in his way: melee in a line 160 behind the hero along the camera's yaw, ranged 300 behind, flanking 120 to each side per pair (`followSlot`). |
| C | Squad: attack the soft target. When it falls the squad follows again. |
| L | Learn the next skill (see Spells). |
| Click a spell bar slot | Cast its skill, as 1 to 4 do. |
| Click a slot's + | Learn that skill's next rank. |
| 6, 7, 8, 9, 0, - | Switch the camera: Exploration (950 away, 24 degrees down), Wide action (800, 21, halfway between Exploration and Close action), Close action (650, 18, the start), Shoulder (420, 10), Ground level (280, 4), Tactical (1300, 38). |

Every key registers twice with `BlzTriggerRegisterPlayerKeyEvent`, key down
(`true`) on one trigger and key up (`false`) on another, so the map knows
which keys are held without repeated tapping and without
`BlzGetTriggerPlayerIsKeyDown`. Each trigger reads its key as
`GetHandleId(BlzGetTriggerPlayerKey())`, the key's virtual-key code; the keys
register as `ConvertOsKeyType(code)`, which is how common.j defines each
`OSKEY_*` constant.

### The map's own interface

Nothing is ever selected: `EnableSelect(false, false)`,
`EnableDragSelect(false, false)` and `ClearSelection()` at start. With no
selection there is no command card, so no Warcraft hotkey fires on the map's
keys (a key event doesn't stop Warcraft from using a key, no native changes
a command's hotkey, and hiding command buttons, or the move and attack
abilities, either let the hotkeys through or stopped WASD's orders). The
map draws its own interface instead (src/hud.ts), every client creating and
filling every player's from synchronized unit state every 0.1 s and showing
each player only their own:

- a green health bar in the bottom-left corner, showing the health as
  numbers, with a blue mana bar under it: BACKDROP fills whose width is the
  hero's whole percent (`percentOf`, `barWidth`) over black backings (no
  portrait);
- a spell bar at the bottom center, one 0.04 slot per skill of the picked
  hero, in learning order with keys 1, 2, 3 and 4 (none on a passive). Each
  slot shows its icon (Warcraft's disabled icon until learned), its key, its
  rank (`rankText`, "1/3") and the seconds its cooldown has left
  (`BlzGetUnitAbilityCooldownRemaining`). A slot is a BUTTON: a click casts
  its skill. While the hero has a skill point and his level allows a skill's
  next rank (`canLearn`), Warcraft's learn icon (`BTNSkillz`) shows above
  its slot, and a click on it learns that rank. A click disables and
  re-enables the clicked button so the keyboard goes back to the game.

One second after start (`arrangeInterface`, on a one-shot timer, as a
published map does: parts moved at once never showed), Warcraft's own
interface leaves the screen:

- `BlzEnableUIAutoPosition(false)` stops Warcraft from placing its frames
  itself, so it doesn't move them back.
- The world frame is stretched over the whole screen
  (`BlzFrameSetAllPoints(world, gameUI)`), so the 3D view reaches the bottom
  edge, and the console's black `ConsoleUIBackdrop` is hidden.
- The minimap moves to the top-right corner of the 4:3 frame space, 130
  square and 5 in from its edges (`showMinimap`, `MINIMAP`); on a wide
  window that is short of the window's own corner. Placed past 0.8, toward
  the window's corner, it didn't show. It hides (`BlzFrameSetVisible`) while
  the player is in a scene: moved below the screen and
  back, it didn't come back after a scene. Every client makes the same calls, each placing its own
  player's minimap.
- Every other part moves below the screen (`moveAway`): the stone bars and
  their overlays (`ConsoleBottomBar`, `ConsoleBottomBarOverlay`,
  `ConsoleTopBar`, `ConsoleTopBarOverlay`), the unit info
  (`SimpleInfoPanelUnitDetail`), the Inventory label (`InventoryText`), the
  top bar's menu buttons and resources (`UpperButtonBarFrame`,
  `ResourceBarFrame`), the minimap's 5 buttons, the hero icon, the
  portrait and its numbers, the command card's 12 buttons and the
  inventory's 6 slots. Moving works where hiding didn't: hiding the stone bar
  hid its neighbours with it, and Warcraft showed the Inventory label again
  as the selection changed. F10 still opens the menu and F12 the log.
- The build also writes a Game Interface file (war3mapSkin.txt,
  scripts/rps.ts) as a published map does, one `[CustomSkin]` section pointing
  `ConsoleTexture01` to `04` and `ConsoleInventoryCoverTexture` at Warcraft's
  transparent `UI\Widgets\EscMenu\Human\blank-background.blp`.

### Manual combat

The hero has no attack ability (`UnitRemoveAbility(hero, 'Aatk')`), so he
never swings on his own; the squad still fights as usual. All timing is in
camera ticks (0.03 s) in each player's synchronized state, handled by the
camera tick, so swings survive a hot reload and need no timer of their own.
Angles are integers: `atan2Tenths` finds a direction's angle by a binary
search over the sine table, since Lua's `math.atan` differs between
platforms.

- **Target**: every 3 camera ticks a hero without a living, visible target
  within 900 picks one on his own: the enemy within 700 whose distance plus 2
  units per degree off the camera's view is least (`autoTarget`), so the one
  ahead wins over one as near behind. A target, picked or Tabbed to, keeps
  until it dies or leaves 900.
- **Swing** (left click on the ground, or Space): with an enemy targeted the
  hero turns to face him (`attackFacing`, `BlzSetUnitFacingEx`) and strikes
  that way; without one he strikes his own front, the way WASD last moved him
  (`GetUnitFacing`). The click says when, never where (aiming at the clicked
  point was tried and dropped). He stops where he stands and plays his attack
  animation at 1.4 times speed
  ("attack", the finisher "attack slam"). Five ticks (0.15 s) in, as the
  weapon sweeps through, every enemy within 175 and 55 degrees of the aim
  (`inCone`) takes `UnitDamageTarget`: 35, 35, then 65 for the third swing of
  a combo (`nextComboStep`: a swing within 0.9 s of the last one's recovery
  continues it). The hero can swing again 19 ticks (0.57 s) in, 14 after the
  damage lands, and 10 ticks (0.3 s) later after the finisher (`swingTicks`);
  WASD moves wait for the swing to end, since a move order would cut it short.
- **Feel**: a press in the last 8 ticks (0.24 s) of a swing's recovery is
  buffered and swings the moment the recovery ends, so a combo flows without
  exact timing; earlier presses are dropped (`bufferable`), so clicking as
  fast as possible swings no faster than the swing allows. A
  melee hero aiming within 20 degrees of a target just out of reach (past
  150, within 300) steps toward it first, at most 130 and stopping 130 short
  of it (`stepIn`), so the swing doesn't hit air; unlike the dropped lunge, he
  steps only then, and never into the unit. Once the damage has landed, the
  guard cancels the rest of the swing's recovery. Each model's weapon lands
  at its own point in the animation: `-impact N` makes the damage land N
  ticks into the swing (5 by default, 2 to 20).
- **Ranged**: the eleven ranged heroes (Archmage, Blood Mage, Far Seer, Shadow
  Hunter, Keeper of the Grove, Priestess of the Moon, Lich, and the tavern's
  Naga Sea Witch, Dark Ranger, Goblin Tinker and Firelord; `ranged` in
  src/roster.ts) keep Warcraft's own attack, which melee heroes lose at
  spawn: a click or Space orders it at the soft target (`rangedAttack`),
  with the hero's own missile, range, damage and cooldown, and he closes in
  when the target is out of range. Without a target the click does nothing,
  and his attack still fires at enemies that come into range while he holds
  his ground. No combo, swing timing or reach step applies to them, and a
  hit doesn't make them hold position (that is for melee heroes, who have no
  attack and would run). An earlier hand-made shot, a missile effect flown
  27 a tick that hit the first enemy within 70, was taken out: Warcraft's
  attack plays better. Untested in Warcraft yet.
- **Weight**: every hit spawns a slash effect; the hero and the units he hit
  freeze for 2 ticks (`SetUnitTimeScale` 0, hit-stop); the finisher knocks
  them back 85. Melee doesn't shake the camera: the damage a swing or a
  counter-slash deals is marked while it lands (`meleeHit`), so the shake
  never takes it for spell damage. Knockbacks go through
  `SetUnitPosition`, which keeps a unit to where Warcraft's pathing lets it
  stand, so none ends in a cliff or a tree. A 45 lunge on each swing was tried
  and dropped: in Warcraft every click dashed the hero, and he bumped back
  off the unit he lunged into.
- **Spell bar clicks**: a click on the bar also reaches the world as a mouse
  press, so a left press waits 2 ticks (`CLICK_SETTLE_TICKS`) before it
  swings, and a spell bar click within 2 ticks of it, before or after,
  cancels it (`isSpellBarClick`).
- **Guard** (Q, held): the hero slows to 3/5 speed and Mana
  Shield's bubble wraps him for as long as the guard is up (blocks spend his
  mana, as Mana Shield does). Standing, he stops and takes up his guard pose:
  the model's combat stance ("stand ready"), or the animation `-guard N T`
  picked, frozen T ticks in (`-guard` alone goes back to the stance). Moving,
  he walks at 0.6 times animation speed instead of sliding a frozen pose
  about, and takes the pose up again when the keys are released
  (`guardFootwork`). A hit on him (`EVENT_PLAYER_UNIT_DAMAGED`, before the
  damage applies) from within 65 degrees of his facing is judged by
  `guardOutcome`:
  - within 8 ticks (0.24 s) of raising the guard it is **parried**: no
    damage, a spark at his weapon and "Parry!" over him, the attacker knocked
    back 90, and a counter-slash at twice speed that turns him to the
    attacker, hits him for 40 (`PARRY_COUNTER_DAMAGE`, flagged so a guarding
    attacker can't parry it back into a loop) and freezes him for 2 ticks;
  - later it is **blocked** while he has 10 mana: a fifth of the damage, 10
    mana, a defend flash, a 35 slide back and the guard pose replayed at 1.5
    times speed, a recoil, before it settles (3 ticks for a frozen pose);
  - without the mana the guard **breaks**: it drops, "Guard broken!" rises
    over him and he staggers for 20 ticks (0.6 s), playing "stand hit", unable
    to swing, guard or move (`canAct`).

  A hit from behind lands in full. Releasing the guard restores his speed.
- Every model numbers its animations differently: `-anim N` plays animation
  N so the player can find the hero's swings, and `-combo A B C` makes the
  three swings play those indices (`SetUnitAnimationByIndex`).

The mouse events (`EVENT_PLAYER_MOUSE_DOWN` and `_UP`) carry the click's
world point, so the map never follows the pointer between clicks: a
continuous mouse-move event would send every twitch over the network.
Nothing is selected, so clicks neither select units nor order the hero.
Bash, an on-attack passive, has no attack to ride on.

### Spells

3, 4, 5 and R, or a click on a spell bar slot, order the hero to cast that
skill by its targeting (`castSkill`): for the Mountain King, Storm Bolt
(`thunderbolt`) at the Tab target, Thunder Clap (`thunderclap`) and Avatar
(`avatar`) at once; Bash is passive. Orders reach the hero without selecting
him.
When Warcraft refuses the order the player reads that the spell can't be cast
now: not learned, recharging or out of mana. Holding a WASD key re-issues its
move every 0.15 s, which interrupts a cast.

The player learns skills: a click on a slot's learn icon learns that skill's
next rank, and L learns the one `nextSkill` picks (Avatar once the hero
reaches level 6, otherwise the lowest-ranked of the three basic skills, in
order). A rank needs a skill point and a hero level of 2n - 1
for rank n, 6 for Avatar (`canLearn`); `SelectHeroSkill` learns it. On every
`EVENT_PLAYER_HERO_LEVEL` the player reads that a point is waiting.

## How it works

Key events reach every client, so each player's held keys, yaw, combat
timer, squad order and soft target are synchronized state in the `__rpsState`
global, which a [hot reload](hot-reload.md) keeps. Everything that becomes an
order or an owner change is integer math in src/rules.ts: angles are tenths
of a degree, sines come from a whole-degree table scaled by 10,000 and
interpolated linearly, and positions are floored to whole units before use.
Warcraft's `Sin`/`Cos` and Lua's math library differ between platforms, and
the [number rules](../plugins/number-rules.ts) (wisp:plugins/number-rules.ts) reject them in synchronized code.

| Timer | Handler | What it does |
| --- | --- | --- |
| 0.03 s | `rps.camera` | Lands, ends and thaws swings and freezes a raised guard (`fightTick`); every third tick picks a target for a hero without one; counts the 4 s combat timer down; every fifth tick (0.15 s) re-issues WASD moves and holds the hero's ground (`holdGround`); then turns the local camera by the right-mouse drag and applies it. |
| 0.10 s | `rps.occlusion` | Hides trees between each player's camera eye and hero. |
| 0.10 s | `rps.hud` | Fills every player's health and mana bars, spell bar, quest journal, interact hint and inventory, and brings his Warcraft quest log up to date. |
| 0.5 s | `rps.stance` | Orders a following squad's strayed units back to their slots; ends an attack whose target fell; drops a dead soft target; keeps the race bases busy (`baseLifeTick`, see Race bases). |
| 1 s | `rps.capture` | Hands each outpost to a player with units in 350 range and no enemies there. |
| 5 s | `rps.income` | Pays each player 20 gold per outpost they own. |

### Camera

At start the local player's camera locks to their hero with
`SetCameraTargetController(hero, 0, 0, false)`: `false` keeps it from turning
with the hero's facing at once. Each camera tick sets rotation and the
player's preset (`CAMERA_PRESETS`: distance, angle of attack, field of view,
base Z offset; Close action's 650, -18°, 75 and 120 at start,
`DEFAULT_CAMERA`) and far Z 6000 over 0.03 s, so Warcraft interpolates between
ticks and a preset change eases in. Keys 6 to 0 and - pick a preset; the choice is
synchronized, so the tree occlusion follows it. The player turns the camera
by holding the right mouse button and dragging (`dragTick`): this client
reads its own pointer (`BlzGetMouseScreenPosX`, in frame units or pixels
depending on the game build) and turns its camera at once (`dragYaw`: a
whole screen's width a full turn, dragging right turns right), and every 3
ticks sends the new yaw to every client (`BlzSendSyncData`), where it becomes
the yaw WASD and the tree check go by. Only a drag sends anything: a
continuous mouse-move event would send every twitch over the network. The
earlier automatic follow behind the hero (`followYaw`) is off for now.
It holds its distance and angle in combat too, apart from a short shake on
impact. The Z offset is
the preset's base plus `max(0, eyeZ - heroZ)`: `GetLocationZ`
samples the ground under the hero and under the camera eye
(`GetCameraEyePositionX/Y`) through one reused location, so a hill behind
the hero lifts the camera instead of clipping into the lens. These calls run
only for the local player and change only what that player sees.

### Combat and trees

A trigger on `EVENT_PLAYER_UNIT_DAMAGED` for every player slot resets a
player's combat timer to 4 s whenever their hero or a retinue unit deals or
takes damage; while it runs, a following squad fights near the hero.

The camera shakes for 0.15 s on impact: when a siege attack
(`BlzGetEventAttackType() === ATTACK_TYPE_SIEGE`) lands within 500 of the
hero, or when the hero's own spell damage (`BlzGetEventIsAttack()` false)
lands, unless it is his own swing or counter-slash (`meleeHit`), whatever
Warcraft reports for it. The Mountain King has no critical strike, so his Storm Bolt and
Thunder Clap stand in for it. The shake sets `CameraSetSourceNoise` and
`CameraSetTargetNoise` to magnitude 4, velocity 100 on that player's screen;
the camera tick counts the 150 ms down in synchronized state and sets both
back to 0.

### Kill cam

When a fight ends, the camera glides onto the last enemy to fall and watches
it die in slow motion (src/killcam.ts). A trigger on `EVENT_PLAYER_UNIT_DEATH`
for every player slot checks each hero the dead unit was an enemy of: if the
hero is in combat, it fell within 900 of him and no other living enemy unit
(buildings aside) stands within 900 of him (`endsFight`), his player gets the
shot. It lasts 90 camera ticks (2.7 s). `killCamShot` takes the player's own
camera (preset, yaw) to a close, low view of the fallen unit (380 away, 15
degrees down, a 60-degree lens, 70 up) over 12 ticks, turning 15 degrees round
it, holds, and glides back over the last 12, smoothstepped at both ends. The
camera stays locked to the hero through `SetCameraTargetController`, its
offset carried from the hero to the fallen unit, so the glide back ends where
the player's camera was; a scene starting meanwhile cancels the shot.

Slow motion is per unit, since Warcraft can't slow a multiplayer game: the
fallen unit and every unit within 600 of it play their animations at a quarter
speed (`SetUnitTimeScale`) until the shot ends. Every speed change the map
makes goes through `timeScale`, which, for a slowed unit, records the speed
the fight asked for and plays a quarter of it, then hands it back when the
slow motion ends. Only animations slow down: units still move and swings still
land on their ticks. Every client runs the check alike; only the camera is
local.

Every 0.1 s, the map computes each player's camera eye from
synchronized state (`eyePoint`: behind the hero along the yaw, by the
distance's horizontal part) and enumerates destructables with
`EnumDestructablesInRect` in a rect around the eye and the hero, grown by 350.
A tree occludes when it is within 350 of the eye or of the sight line to the
hero (`occludes`, 32-bit-safe integer math). The occluding set is kept for
every player in every client; only the local player's newly occluding trees
get `ShowDestructable(tree, false)` and those that left the cone
`ShowDestructable(tree, true)`. Hiding a destructable for one player is a
local visual change; whether Warcraft keeps its pathing identical for every
client is not yet checked on a native client.

### Squad and targets

The hero is a Mountain King and the retinue two footmen (melee) and two
riflemen (ranged); with the hero's 5 food they fill the 15-food cap exactly, set as both the food cap and its
ceiling. The squad has three orders (`squadOrder`): it follows (X, and at
the start), holds where Z stopped it, or attacks the target C named, until
the target falls. While following, out of combat a unit more than 96 from
its slot (`squadSlots`, `followSlot`, all behind the hero) walks back to it. In combat (the
4 s combat timer, which C also starts) a new order would cancel a unit's
attack mid-swing, as footmen showed in Warcraft, so a unit is left to fight
unless it strays over 700 from the hero (`LEASH`), when it walks back to its
slot rather than fighting its way back: following the hero means falling
back from a fight. Holding or attacking, the squad gets no regroup orders.
The earlier stances (Vanguard on 1, Tight Guard on 2, `guardSlot`) gave way
to the skills on 1 to 4. Vanguard put the melee 180 ahead of the hero, in his way; the follow formation keeps the whole squad behind him. Tab enumerates units in 900 range with
`GroupEnumUnitsInRange`, keeps living, visible enemies and orders them by
squared distance, then handle id, so every client picks the same next target
(`nextTarget`). The target is marked for its player alone, as an action
game's lock-on: a red ring on the ground under it and a red cast over the
unit. The ring is Warcraft's spell-area circle (SpellAreaOfEffect.blp) as an
image (`CreateImage`, the selection type, red by `SetImageColor`), twice the
unit's collision plus 70 across, at least 110 (`ringSize`). Warcraft places
an image by its lower-left corner (`ringCorner`), and the camera tick moves it
with the target (`SetImagePosition`). Every client makes the same ring and
hides it; only the targeting player's client shows it (`ShowImage`) and tints
the unit (`SetUnitVertexColor` 255, 130, 130), and only his clears the tint
when the target is dropped.

### Outposts

`registerOutpost(unit)` adds any unit as a capturable outpost. At start the map
registers every pre-placed circle of power (`ncop`) in the playable area. A
base map with none but with gold mines, such as a melee map, gets a neutral
outpost beside each gold mine that isn't a player's home mine (within 1500 of
their start location, `isHomeMine`): 320 from the mine toward the map's
center (`outpostBeside`), guarded by the map's own creep camps. A map with
neither gets three outposts around the center, each guarded by three gnolls.
Each player's hero and squad start at his race's base or a tavern (see Picking a hero). Each capture check counts the owners of living
units in 350 range; `captureOwner` gives the outpost to a player who may
capture (one of the map's players) when none of that player's enemies is
present. The owner keeps a contested or empty outpost, and among several
allied capturers the lowest player id wins. `SetUnitOwner(outpost, player,
true)` changes its color too. The build suppresses the base map's default
melee initialization ([the base map](sample-map.md#the-base-map)), so there
are no starting workers or town halls.

### Leaks

The map reuses one group, one rect, one location and one filter for every
query and never creates temporary locations; orders use coordinate natives
(`IssuePointOrder`, `IssueTargetOrder`).

### Holding ground

A unit that can't attack runs from whatever hits it, and the hero has no
attack ability, so he fled from enemies when hit, mid-swing too. Holding
position stopped most flights but not all, so the hero is rooted while the
player isn't walking him (`rootTick`): with no movement key held, mid-swing,
staggered or in a scene, his propulsion window is 0 (`SetUnitPropWindow`),
and Warcraft can't move him whatever order it gives. Turning, knockbacks,
step-ins and a scene's places (`SetUnitPosition`) still work, and a movement
key gives him back his own window (`GetUnitDefaultPropWindow`) on the same
tick, before the move order goes out. A swing, raising or lowering the guard
and a broken guard still order hold position rather than stop. While no
movement key is held and no scene plays, a move he didn't
order (a flight, or the rest of the last WASD step: `GetUnitCurrentOrder`
reading move or smart) gives way to hold position (`holdGround`, every
0.15 s, swinging or not, and at once when he is hit outside a swing).
Releasing WASD stops him where he stands.

## Dialogue scenes

**The scene engine and its host**: scenes and their quests run in three
modules apart from the map's entry, so another map can run them by
supplying what they ask of it:

- src/scenes.ts plays scenes: barks and the "!" marks (`talkCheck`), the
  nearest NPC in talking range (`talkTarget`), starting (`startScene`), playing, advancing and ending a scene, voices,
  the scene camera and the fades (`sceneTick`, `fadeTick`), Space, Esc,
  1 to 4 and choice clicks (`skipLine`, `endScene`, `chooseLine`), the voice
  length sync (`voiceSynced`) and `-scene` (`playNearest`).
- src/questRuntime.ts runs what a line's `fight`, `hostile` and `ally`
  effects put in the world (`raiseFight`, `turn`, `enlist`), lets them loose
  as the scene ends (`releaseScene`), marks objectives, and pays bounties and
  sends allies home every 0.5 s (`questTick`).
- src/questLog.ts keeps each player's quests in Warcraft's own quest log
  (`syncQuestLog`; see "Warcraft's quest log").
- src/sceneHost.ts is the contract between them and the map. A
  `SceneSeat` is what the engine reads and keeps per player (his hero, its
  rawcode and name, his letterbox, scene, flags, barks, "!" marks, fade and
  quests in Warcraft's log);
  the map's own player record carries these fields among its own. A
  `SceneState` names the engine's fields in the map's state global (the
  NPCs, the center, the shared group and location, voices, tags, bounties,
  objectives, held units and allies), so a hot reload keeps them as it keeps
  the rest. A `SceneHost` is what the map supplies, from install() through
  `installScenes`, so a reloaded bundle rebinds it: its state and clock,
  its debugging switches, standing the hero down as a scene starts, a
  soldier to stand beside him, the line placeholders, `recruit` and `spawn`
  effects (the map's own party), and hiding and bringing back its own
  interface around a scene. Its members are plain functions with no `self`
  in Lua, so the map hands in arrow functions.

src/main.ts places this map's NPCs (taverns with their sergeant and
sellsword, wanderers, quest sites, race bases), implements the host, and calls the engine from its timers,
keys and clicks. The scene modules still read the map's pure rules and data
(src/dialogue.ts, src/units.ts, src/letterbox.ts, src/rules.ts,
src/combat.ts, src/constants.ts); a map that runs them today copies those
too.

E, the interact key, near an NPC (within 350) plays that NPC's scene, for
his player alone: a personal scene. The other player keeps playing, so
nothing of theirs pauses. Walking up to an NPC only shows "E  Talk to ..."
over the spell bar (`interactHint`); E can start the same NPC's scene again
at once. `-scene` plays the nearest NPC's scene from anywhere, for trying
scenes out.

**Unit profiles** (src/units.ts, `UNITS`): everything the map knows about a
unit type beyond Warcraft's own data sits in one profile per rawcode, so
adding a unit type is adding one entry. A profile has a name, the starting
life the headless journey gives the type (`unitStates` reads it), and
optionally:

- `voice`: where its voice recordings may be, as file prefixes tried in
  order (Units\Human\Footman\Footman, to which a kind and a take are added:
  FootmanWhat1.wav). The first time a scene needs the voice, `voicePrefixOf`
  asks the game which prefix has a recording of any kind
  (`GetSoundFileDuration` above 0) and keeps it; if the game can't tell for
  any, the first is tried as it is. A type without a voice is silent. A
  profile can list guesses when the sound set's name isn't certain: the
  Spellbreaker and the Ogre Magi list three each.
- `talk` and `gestures`: its own talk animation and mood gestures, in place
  of the map's "stand talk" and `gestureOf` (`talkAnimation`, `gestureFor`).
- `face`: how high its face is above the ground (`faceHeight`), for a type
  taller or shorter than the map's 60: 210 for the Ogre Magi, 170 for an
  ogre, about 130 for riders such as the Archmage and the Knight. A scene's
  camera looks at the speaker's face, or halfway between both in a two-shot
  (`shotFace`), and stands back by however much taller than 60 it is (half
  that in a two-shot), so a tall speaker fits: at 60 for everyone, the camera
  framed an ogre's feet.

A test (src/units.tests.ts) collects every unit type the map creates (the
races' heroes and soldiers, every scene's NPC, spawns and fights, the quest
sites' companies, the creeps and the outpost) and fails, naming the rawcode,
for any without a profile. Lookups are table reads, and the voice search
runs once per unit type, as its first scene starts under the fade from
black, so profiles cost the game nothing it would notice.

**Configuration** (src/dialogue.ts): `MOOD_SUFFIXES` maps a line's mood to the set's kind of line (neutral and
question to What, confirm and command to Yes, attack to YesAttack, warcry to
Warcry, angry to Pissed). How many recordings of a kind a set has differs
(the Footman has 7 Pissed lines, others 4), so the map measures it in the
game rather than assume it: the first time a scene needs a unit type's kind,
`takesOf` tries its files from 1 up (`recordingFile`) and counts while
`GetSoundFileDuration` says the file is there, up to 10 (`countTakes`), and
keeps the count, at least 1, so a game that can't tell still plays the first
take. Every client has the same game files and asks the same questions, so
every client counts alike.

A `Scene` names its NPC, his unit type, its start node, and optionally
`openings` (a start node per set of conditions, the first met wins over
`start`) and a `bark` (a line and mood the NPC calls out to a hero walking
past). Each `DialogueNode` has:

- a speaker: `hero`, `npc`, or `squad`, a soldier of the hero's squad, and
  optionally whom he talks to (`to`; by default the hero talks to the NPC, the
  NPC and the soldier to the hero);
- text, a mood, and optionally its own shot (in place of the director's), an
  `important` mark (a close-up), an animation (in place of the mood's
  gesture) and a voice pitch in percent;
- `when`, conditions under which it plays; unmet, or with a soldier the hero
  hasn't got, the line is passed over for its `next`;
- `effects`, what it does as it plays, in order;
- a `next` node, or up to four `choices`, each jumping to its own node and
  optionally with conditions of its own: unmet, the choice shows greyed out
  and can't be taken, or doesn't show at all when it is `hidden`. A node with
  neither ends the scene.

A **condition** is a flag the player has (`{ flag }`), one he hasn't
(`{ notFlag }`), gold (`{ gold }`) or one of the heroes it names
(`{ hero }`, by rawcode). Flags are what each player's scenes
remember: names effects set, and `seen:<scene>`, set on a player who has
played a scene through. An **effect** is `gold` (paid, or taken when
negative), `recruit` (a role's two soldiers for a cost, as recruiting
does), `flag` (set, or cleared with `value: false`), `spawn` (units of a type
that join the hero's squad in a role), `fight` (hostile units held until
the scene ends, then attacking him: from 700 behind the hero, around the
NPC's site 300 out with `at: "site"`, or around a camp 900 past the NPC,
away from the map's center, with `at: "camp"`; or, with `at: "objective"`,
standing guard 200 around the scene's objective until the hero comes, see
Objectives), `hostile` (the NPC, or his
company of one unit type with `code`, turns on the hero as the scene ends:
it joins the hostile creeps, can be hurt and attacks, or with `hold` stands
dazed that many seconds first), `ally` (the NPC, or his company of one unit
type, fights on the hero's side as the scene ends: he passes to the hero's
player, still unhurtable, and attack-moves to the hero; once every unit under
his `tag` has fallen he goes neutral again and walks back to his post) or
`heal` (the hero's life and mana back to full). Without `ally`, an NPC who
promised help stood watching: neutral, passive units never fight. A `fight` or `hostile` effect files its units under a `tag`, for the
player, and may carry a **bounty**: once every unit under the tag has
fallen, checked every 0.5 s (`questTick`), it pays its gold, sets its flag
and tells the player. New
consequences are new data, not new engine code.

`sceneProblems` checks that every start, opening, next and choice names a node,
and that no node offers more than four choices; a test runs it on every scene.

**The example**, `TAVERN_SCENE`: Sergeant Brenn, a footman, stands 300 from
each tavern the base map has, toward the center (Ordeal Ground has two), or
near the center without one. He greets the hero, the hero asks about the
outposts, the sergeant tells him angrily about his brother's patrol, and a
soldier of the hero's squad, if he has one, says he doesn't trust him. The
sergeant then asks for help, with four choices: help (50 gold and the flag
`helpingSergeant`, then the hero's war cry), "Pay me first" (the flag
`insultedSergeant` and two gnolls who attack once the scene ends), give 50 gold
for his brother's family (greyed out with less gold; it also sets
`helpingSergeant`), or refuse (`insultedSergeant`). Coming back, he opens
coldly on `insultedSergeant`, or asks after the mines on `helpingSergeant`.
His bark: "You there! A word, if you've a moment."

**The wanderers** (`WANDERERS`): three more NPCs stand around the playable
area's center, 1100 out and a third of a turn apart, facing it, each put where
Warcraft's pathing lets him stand (`SetUnitPosition`). Their scenes build on
the sergeant's:

- `SCOUT_SCENE`, Ilyra, a night elf archer: she won't talk to a stranger, but
  to a hero helping the sergeant (`helpingSergeant`) she says the patrol's
  tracks end at the eastern mine, pays 40 gold and sets `knowsMines`; a
  soldier of his squad says they'll follow. After that she only hurries him on.
- `MERCENARY_SCENE`, Gor'mak, an orc grunt: two forest trolls for 90 gold
  (greyed out without it), or his challenge (`provedToGormak`), two gnolls
  waiting at the gnoll den, his objective; once they fall (`pupsBeaten`),
  come back and he gives the trolls for free. Back before then, he sends the
  hero to the den again. He gives the trolls once (`gormakPaid`).
- `HEALER_SCENE`, Sister Maren, a priest: she heals the hero, life and mana,
  for 20 gold, and once for free for a helper of the sergeant's (a hidden
  choice, shown only with `helpingSergeant` and before `marenFavor`).

**Starting a scene** (`startScene`): the hero drops his guard and swing,
stops, can't be hurt (`SetUnitInvulnerable`) and steps to 260 from the NPC on
the side he came from (`talkSpot`): far enough apart that the over-the-shoulder
and two-shot cameras have room between them (at 160 the two crowded each
other). If the scene has lines for a soldier, the
hero's first living one steps up at his left shoulder, a little back. Units
within 1600 pause (`PauseUnit`), the actors and other players' units
excepted. The scene opens where the player's flags say (`openingOf`). His
screen fades in from black over 0.3 s (`fadeAlpha`), his HUD and minimap hide,
and the scene shows its line as text with up to four numbered choice buttons
in Warcraft's dialog style at the right above it, shown only on lines that
branch (src/letterbox.ts). There are no letterbox bars and no cinematic mode:
the map's own bars were clipped to the screen's 4:3 middle, so the line sat
in a black box, and Warcraft's cinematic mode (`ShowInterface(false)`),
whose borders reach the window's edges, took the player's cursor, keys and
clicks, so the choices couldn't be picked. While a scene plays every other
control of that player stands down (movement, attacks, guard, spells, the
follow camera and the automatic target): Space skips a line without
choices, cutting its voice short; a click or 1 to 4 picks a choice; Esc ends
the scene.

**Each line** (`playLine`):

- The speaker and the listener turn to each other over 0.3 s. Heads don't
  turn on their own: the head look-at (`SetUnitLookAt`) was taken out.
- The speaker gestures: the node's animation, else his mood's (`gestureOf`:
  "stand victory" for a warcry, "attack" for anger, "stand ready" for a
  command), then talks: "stand talk" (`TALK_ANIMATION`), which Warcraft
  plays as the model's animation tagged Stand and Talk, or as a stand on a
  model without one. He talks for the whole line until his voice is measured
  (`voiceSynced`), then until it ends (`talkTicks`), and goes back to
  "stand"; the last speaker does too when someone else speaks, and every
  actor as the scene ends.
- His voice plays the next recording of his mood's kind (`voiceFile` with the
  scene's line count: FootmanWhat1, then FootmanWhat2, and so on, round the
  recordings the set has), played with `CreateSound` at full volume, the
  node's pitch and `KillSoundWhenDone`, made in every client and silent in all
  but the scene player's. Sound labels (`CreateSoundFromLabel`) played nothing
  in Warcraft, so the map names the files. Warcraft may drop a file's first
  play while it loads it, so a scene plays every recording its lines may play
  once, silent, as it starts.
- Its effects happen.
- The line shows as plain text (`showSubtitle`): the speaker's name in gold
  over his line, centered low on the screen (`SUBTITLE`), with no panel and
  no portrait. Any choices show, stacked at the right above the line.

A line without choices advances after 2 seconds plus its reading time at 15
characters a second (`lineTicks`), or, if its voice runs longer, after the
voice plus half a second (`voiceTicks`). Only the scene player's client
measures the voice (`GetSoundFileDuration`); it sends the length to every
client (`BlzSendSyncData` under `rpsvoice`), which keeps the line up that long,
so every client advances on the same tick.

**The camera** is the shot director's (`directShot`). A scene opens on a
two-shot of both actors; an angry line, a warcry or an `important` one is a
close-up; the rest go over the listener's shoulder; a node's own shot wins.
A new speaker is a cut to the reverse shot. The same speaker going on never
cuts to the same shot: the camera glides over about 1 s (`sceneFraming`,
smoothstepped, turning the short way round) from wherever it had got to, from
a two-shot to his over-the-shoulder shot, from that to a close-up, and on a
close-up it stays. Over a line it holds still: no drift and no sway
(`DRIFT_DISTANCE` and `DRIFT_YAW` are 0).
The shots are worked out from the actors' positions with the integer
arctangent (`framing`):

- `OTS`: over the listener's right shoulder onto the speaker, from beside
  him rather than behind him: 120 past his collision size to his right
  (`BlzGetUnitCollisionSize`) and 40 back from there, looking at the
  speaker, 8 degrees down. Straight behind a big hero (a Dreadlord's wings)
  the listener filled the frame; from beside him he is a shoulder at its edge;
- `CLOSEUP`: on the speaker's face, 190 away, 24 degrees off axis, a 54-degree
  field of view;
- `TWOSHOT`: wide and perpendicular to the line between them, on their
  midpoint, from 330 beyond their distance apart (at least 460).

The camera is set every tick on the scene player's client, a cut's first tick
at once and the rest over one tick. It stays locked to the hero, offset onto
the shot's target (`SetCameraTargetController` with the offset), so nothing
has to be unlocked. It looks 60 above the ground (`FACE_HEIGHT`, a face's
height: at 140 it looked down over the actors' heads), from shallow angles (8
degrees down over the shoulder, 3 in a close-up, 10 in a two-shot), and rises
by however far the speaker stands above the shot's target, so uphill
conversations keep faces framed.

**Ending** (`endScene`, at the last line or on Esc): the voice stops, the
line and the choices go and the screen fades to black
over 0.3 s. Under the black (`finishScene`) the paused units unpause, any
enemies the scene raised come for the hero, the hero can be hurt again, the
actors stand, the player gets the scene's `seen:` flag, and the HUD, the minimap
and the hero's follow camera come back as the screen fades in again
(`arrangeInterface` puts Warcraft's interface where the map keeps it).

**Quests** (src/quests.ts, `QUEST_SITES`): four more NPCs stand 2400 from the
playable area's center, a quarter turn apart, each with his company in rings
around him, all unhurtable until they turn. They run on the map's current
combat; their fights are `fight` and `hostile` effects with bounties, and an
NPC who has turned can't be talked to again (`talkable`).

- `CONTAINMENT_SCENE`, Battle-Mage Seris, a Dalaran sorceress outside a
  shattered observatory: her wards on two water elementals and a greater
  one are failing, and they have broken loose to the ley-line rift, her
  objective. Seal them, and she sets out for the rift and fights them beside
  the hero; she pays 80 gold once they fall (`wardsSealed`) and thanks the
  hero after. Harvest their cores instead, and two wait at the rift while she
  turns on the hero where she stands, and the cores pay 140 gold once all
  three have fallen (`coresTaken`).
- `GATE_SCENE`, Captain Haldric, a knight with three footmen, blockading the
  pass against two blood elf Spellbreakers (`TWOSHOT`, then `CLOSEUP`). Force
  the blockade, and he and his footmen turn while the Spellbreakers fight
  beside the hero (the exiles pay 60); enforce it, and the Spellbreakers turn
  while he and his footmen fight beside the hero (he pays 80); or, as the Paladin, Blood Mage or
  Archmage (`NOBLE_HEROES`, greyed for anyone else), order him to stand down
  in the command mood and a Spellbreaker joins the squad. Each ends with
  `gateSettled`.
- `TIMBERLAND_SCENE`, Foreman Gregor, a peasant at the lumber outpost
  (`OTS`), and the hero's sergeant if he has a squad: a daylight assault on
  the troll camp (three forest trolls, two shadow priests and their warlord)
  or a night raid on fewer of them awake (one of each); the camp stands on
  the troll ridge, his objective. Either pays 100 once it falls
  (`campCleared`). The map
  has no day and night of its own yet: the raid is only the smaller fight.
- `OGRE_SCENE`, Gorm-and-Grum, an ogre magi with two ogre bruisers at the
  quarry (`CLOSEUP`, then `OTS`): mock him in the angry mood and he duels
  alone; set his heads arguing over the split in the question mood and he
  and his bruisers stand dazed for 4 seconds as the fight starts; or draw
  weapons and they all come at once. The hoard pays 120 once the fight is won.

**Shadowmeld**: NPCs and the units standing with them (a quest site's company, a base's guards) never move, so a night elf among them (Ilyra, the Night Elf base's recruiter, quest giver and guards) would Shadowmeld at night and turn invisible. Once every NPC is placed, `start` takes Shadowmeld (`SHADOWMELD_ABILITIES`: `Ashm` and `Sshm`) from all of them, so they stay visible day and night. The players' own night elf soldiers keep it.

**Around the scenes**: every 0.5 s, an NPC with a bark turns to a hero walking
past within 600 (but not yet within talking range) and calls out once, a
voiced line over his head shown only to that player, until the hero has gone
900 away; the game doesn't stop. Over every NPC whose scene the player hasn't
played through yet (`hasNews`) stands Warcraft's own "!" (TalkToMe.mdl),
shown only to him: every client makes the same mark, and every other player's
sees through it (`BlzSetSpecialEffectAlpha` 0). The same NPCs carry
Warcraft's gold quest giver icon on his minimap (`CreateMinimapIconOnUnit`,
the interface skin's `MinimapQuestGiverIcon`, or MiniMap-QuestGiver.mdl
without one, shown through fog and black mask), visible only to him
(`SetMinimapIconVisible`); both go once he has played the scene through.

**Objectives**: a quest's enemies don't rise beside the NPC who gives it.
A scene names its objective (`objective`: a place's name, an angle in
tenths of a degree and a distance from the playable area's center), and its
`fight` effects with `at: "objective"` stand there, 200 around it
(`OBJECTIVE_RADIUS`), not paused, and wait as hostile creeps do until the
hero comes. `objectiveSpot` keeps the place 600 inside the playable area
(`OBJECTIVE_MARGIN`). The fight's tag marks it on the player's minimap,
once: Warcraft's quest objective icon (the interface skin's
`MinimapQuestObjectivePrimary`, or MiniMap-QuestObjectivePrimary.mdl
without one) at the place, made in every client and shown only to him, a
4-second ping there on his minimap, and a message naming the place
(`markObjective`). Once every unit under the tag has fallen, `questTick`
takes the icon down. An NPC who allies for the fight (Seris, sealing the
wards) attack-moves to the objective as the scene ends. The places are the
ley-line rift (`CONTAINMENT_SCENE`, 3800 out at 45 degrees), the troll
ridge (`TIMBERLAND_SCENE`, 3800 out at 225 degrees) and the gnoll den
(`MERCENARY_SCENE`, 3200 out at 135 degrees), each at least 1500 from its
NPC (a test checks). `sceneProblems` reports a fight at an objective the
scene doesn't name, or without a tag to mark it by. The icon's file and
skin key are untested in Warcraft yet.

**The quest journal** (src/journal.ts, `JOURNAL`): at the right edge of the
screen under the minimap (`QUEST_LOG`), the player's HUD lists the quests he
is in the middle of, "Quests" in gold over each quest's title in gold and its
objective under it. Nothing is stored for it: each entry is a title, an
objective and conditions on the player's flags (`activeQuests`, with
`meets`), active from the flag the choice that takes the quest sets until the
flag that settles it, usually a bounty's: `helpingSergeant` until
`knowsMines` (find Ilyra), `provedToGormak` until `pupsBeaten` (the den),
then until `gormakPaid` (back to Gor'mak),
`sealingWards` until `wardsSealed`, `harvestedCores` until `coresTaken`,
`gateForced` or `gateEnforced` until `gateSettled`, `campAssault` until
`campCleared`, and `ogreFight` until `ogreBeaten`. A quest is a new entry,
and its start and end flags must be ones a scene sets (a test checks). The
HUD sets the text every 0.1 s (`hudTick`, `journalText`), empty with no quest
under way, and hides it with the rest of the HUD during a scene. The patrol's
search at the eastern mine has no ending yet, so the journal drops the quest
once Ilyra has pointed the way.

**Warcraft's quest log** (src/questLog.ts): the same quests also fill
Warcraft's own quest log, the dialog F9 opens. `questLog` (src/journal.ts)
lists every quest a player has taken, once per title in the journal's
order: active, with the objective of its first active stage, or done, with
the objective of the last stage he finished (a stage is taken once every
flag it starts on is set, and finished once a flag that ends it is set). A
quest he never took stays out, so a path that settles a quest without
taking it (hiring Gor'mak's trolls outright, ordering Haldric down) adds
nothing. Every 0.1 s, once any scene of his is over, `syncQuestLog` brings
his log up to date: a newly taken quest is created as an optional quest
with a scroll icon (`QUEST_LOG_ICON`, BTNSnazzyScroll.blp), its description
the objective; a changed one is rewritten; a done one is marked completed
and stays in the log. Each change (`logChange`: discovered, updated,
completed, each at most once) shows Warcraft's quest message style to him
(`logMessage`: "QUEST DISCOVERED", "QUEST UPDATE" or "QUEST COMPLETED" in
gold, the title and the objective), plays Warcraft's matching quest sound
(`bj_questDiscoveredSound` and the others, which `InitBlizzard` makes) and
flashes the quest button. Warcraft's log is one for every player: every
client creates every player's quests alike, and only each player's own
client enables his (`QuestSetEnabled`), as with his minimap icons. The log
keeps them on his seat (`questLog`), so a hot reload keeps them. The quest
button itself is moved below the screen with the rest of the top bar; F9
should still open the log, as F10 and F12 still open theirs. The log, its
icon, the per-player enabling and F9 are untested in Warcraft yet. The Lost
Patrol shows completed once Ilyra has pointed the way, since its search has
no ending yet.

The voice lengths, look-at, gestures and camera glides are untested in
Warcraft yet: a missing recording plays nothing and the line still shows.

## Items

Nothing is ever selected and the right mouse button turns the camera, so
Warcraft's own pickup (a right click on an item) never happens, and
`holdGround` would cancel its order anyway. E, the interact key, picks items
up instead (`interact`): it reaches the nearest NPC in talking range
(`talkTarget`) and the nearest item lying within 200 of the hero
(`nearestLoot`, `PICKUP_RANGE`), and acts on the nearer (`interaction`;
talking wins a tie, so an NPC standing on loot still answers). Every 0.1 s
the HUD shows what E would do over the spell bar ("E  Talk to Sergeant
Brenn", "E  Pick up Claws of Attack": `interactHint`, `INTERACT_HINT`). A
power-up (a tome, gold coins) is used at once ("You use ..."); anything else
goes into his inventory ("You pick up ...") if it has room, else it stays on
the ground and he is told. Every client enumerates the same items in the
same order (`EnumItemsInRect`), so every client finds the same one. Headless
has no item queries, so the journey finds none; it presses E with nothing in
reach.

**The inventory**: Warcraft's own inventory is below the screen with the
rest of its interface, and shows only a selected unit's, so the HUD has its
own. The Inventory button in the bottom-right corner (`INVENTORY_BUTTON`,
Warcraft's dialog button style), or I, opens and closes a panel above it
(`INVENTORY_PANEL`) with the hero's 6 slots, 3 across and 2 down as in
Warcraft's (`inventorySlot`): each slot shows its item's icon
(`BlzGetItemIconPath`) and charges. A click on a slot uses its item
(`useItem`): on its own (`UnitUseItem`), or else at the soft target
(`UnitUseItemTarget`); an item that can't be used now says so. A click and
a key reach every client, so the panel's open state (`inventoryOpen`) is the
same in all; each player sees only his own. The panel starts closed; the
journey opens and closes it with I. Pickup, power-ups, the hint, the panel,
its icons and item use are untested in Warcraft yet.

## Recruiting

The party starts empty. A race hero spawns at his race's base, whose
recruiter gives him soldiers free (see Race bases). A tavern hero spawns at
a tavern, where the sellsword stands beside the sergeant (src/tavern.ts,
`SELLSWORD_SCENE`, 300 toward the center and 250 to the sergeant's left).
E beside either (or `-scene` nearby) plays its scene. A `recruit` effect
recruits as its line plays (`recruitOutcome`): the hero pays and two
soldiers appear behind him and join his squad ("Two Footmen join you."),
unless he can't afford them or already leads soldiers of that type
(`Member.code`). Whose soldiers they are, the effect says: his own race's
of a role, a base's race's (`race`), its veterans (`veteran`), or a named
unit type (`soldier`, a sellsword's mercenaries). Outposts pay for later
hires. Scene text fills in placeholders per player (`fillLine`): {hero} for
the hero's name, {melee} and {ranged} for what his race's soldiers are
called (Footmen, Grunts, Huntresses, Ghouls; Riflemen, Headhunters,
Archers, Crypt Fiends).

**The sellsword**, Krag, an ogre, hires out mercenaries two at a time
(`SELLSWORDS`): Ogres (melee, 120 gold), Forest Trolls (ranged, 100) and
Forest Troll Shadow Priests (ranged, 110). To a tavern hero who hasn't had
it yet he opens on his free contract: any one pair free, which sets
`FREE_SELLSWORD_FLAG`. Otherwise, and after it, he sells them, each choice
greyed out without the gold, and asks "Anyone else?" until the hero says not
now. Race heroes can hire from him too, always paying. The earlier
quartermaster, who sold each player his own race's soldiers by his start
location, is gone: race heroes get them free at their base, and tavern
heroes have the sellsword.

## Race bases

Four bases stand 2000 from the playable area's center, in the gaps between
the quest sites (src/bases.ts, `BASES`): Human at 45 degrees, Orc at 135,
Night Elf at 225 and Undead at 315. Each has its race's hall and barracks
behind its recruiter (Town Hall and Barracks; Great Hall and Barracks; Tree
of Life and Ancient of War; Necropolis and Crypt), two melee and two ranged
guards of its race in front of him, all neutral and unhurtable
(`placeBases`), the recruiter, a soldier of its race (Marshal Aldren,
Blood Captain Gorth, Sentinel Ilara, Deathlord Varkus), and a quest giver at
his side (Lieutenant Mira, Scout Rokhan, Warden Thalyss, Acolyte Mordis).
Each carries the "!" until the player has talked to him and calls out to
heroes walking past.

E beside a recruiter plays his base's scene (`baseScene`, made from the
race's data so it names the race's own soldiers). As a player's hero
spawns, his scenes get his lobby race's flag (`raceFlag`, `race:Orc`). A
player of the base's race opens on "kin": two of its melee or two of its
ranged soldiers free. Anyone else opens on "stranger": the same soldiers for
90 and 120 gold (`BASE_MELEE_COST`, `BASE_RANGED_COST`; each greyed out
without the gold).
After a hire the recruiter asks again until the hero says not now. The
soldiers are the base's race's, whoever buys them (`recruit` with `race`),
and each party member keeps his own unit type (`Member.code`), so a soldier
of another race speaks with his own voice in a scene. The recruiting rule
still holds: no new pair of a type while the hero leads soldiers of
that type, so a free base doesn't fill the map with soldiers, but a veteran
pair can join beside a basic one of the same role. Units the map creates
ignore Warcraft's food cap, so veterans can take a party past it.

**Base life** (`BaseLife`, `placeBases`, `baseLifeTick`): besides its hall
and barracks each base has two houses (Farms, Orc Burrows, Moon Wells,
Ziggurats), and its people go about their day:

- three workers of its race (Peasants, Peons, Wisps, Acolytes) walk from the
  hall to the houses and the barracks and back, on Warcraft's patrol order;
- two melee guards walk a beat across the base's front, 1200 long, the same
  way;
- a sparring pair by the barracks face each other and swing in turn, a
  second apart (`sparrerOnBeat`: the attack animation, then "stand ready");
- every 8 s someone at the base (a guard, a worker or a sparrer, each in
  turn) calls out a line of its race's chatter over his head ("Keep those
  blades sharp!", "Zug zug.", "Elune watches over us.", "The Scourge never
  sleeps.": `chatterOn`), the four bases a quarter of the round apart. Every
  client makes the text and reads every hero alike; each shows it only to
  his own player, if his hero is within 1600 (`CHATTER_RANGE`).

They are all neutral, unhurtable, stand with the recruiter (his company) and
lose Shadowmeld like every NPC. Their walks, the sparring animations and the
houses' fit on the ground are untested in Warcraft yet.

**Base quests**: each base's quest giver plays its quest scene
(`baseQuestScene`). He asks the hero to clear a camp at the base's own
objective, out past the base, and taking it (`questFlag`, `baseQuest:Orc`)
raises the camp there as hostile creeps standing guard, marked on the
player's minimap (see Objectives):

| Base | Quest | Camp | Objective | Veterans |
| --- | --- | --- | --- | --- |
| Human | Bandits on the King's Road | 3 Bandits, an Enforcer | the bandit camp, 3200 out at 60 degrees | Knights, Sorceresses |
| Orc | Wolves at the Pens | 3 Timber Wolves, a Giant Wolf | the wolf den, 3400 out at 115 | Tauren, Troll Berserkers |
| Night Elf | Murlocs at the Moonwell | 3 Murloc Tiderunners, a Huntsman | the moonwell shore, 3200 out at 245 | Mountain Giants, Dryads |
| Undead | Kobold Tunnels | 3 Kobolds, a Taskmaster | the kobold tunnels, 3200 out at 335 | Abominations, Necromancers |

Once all of the camp has fallen, the bounty pays 50 gold (`BASE_QUEST_GOLD`)
and sets `veteransFlag` (`veterans:Orc`). The quest list and Warcraft's
quest log show the quest while it is under way (src/journal.ts makes an
entry for each base). From then on the base's recruiter shows a fourth
choice, "Your veterans." (hidden before, so the numbers stay 1 to 3): the
race's veterans (`Race.veterans` in src/roster.ts), two melee or two ranged,
free to kin and 150 or 180 gold to anyone else (`VETERAN_MELEE_COST`,
`VETERAN_RANGED_COST`). Coming back, the quest giver hurries the hero on, or
thanks him. Any player can do any base's quest, and it unlocks that base's
veterans for him alone. The bases' placement, buildings on uneven or
unbuildable ground, the Undead base's blight, the camps' creep rawcodes and
the veterans' voices are untested in Warcraft yet.

## Tests

| File | What it checks |
| --- | --- |
| src/rules.tests.ts, test/rules.test.ts, test/lua.ts | The pure rules in Bun, then compiled with tsconfig.tests.json and run in 32-bit Lua (a farm test): the sine table, easing and yaw wrap, the combat timer, terrain lift, eye position, WASD directions, occlusion, Vanguard and Tight Guard slots, Tab cycling, capture, income, the follow yaw and skill learning; src/combat.tests.ts, the integer arctangent, the swing's cone and timing, the combo, step-in, the guard, shots, the automatic target and its ring; src/roster.tests.ts, the roster's shape and its default pick; src/dialogue.tests.ts, voice files and their variants, gestures, line timing by text and voice, scene checks, the tavern scene's branches, the camera shots, the shot director and its glides, the fades, conditions, openings, choice states, news and listeners, the talking spot, filled-in lines, recruiting, and the scout's, mercenary's and healer's scenes and places; src/units.tests.ts, that every unit type the map creates has a profile, the profiles' shape, voice guesses, and talk and gesture overrides; src/quests.tests.ts, the quests' scenes and sites, hero conditions, and each quest's branches, turns and bounties; src/killcam.tests.ts, which death ends a fight and the kill cam's glide and close view; src/layout.tests.ts, the interface's boxes. |
| test/journey.ts, test/headless-lua.ts, test/headless.test.ts | A farm test: the compiled bundle in two simulated 32-bit Lua clients picks the Human Mountain King by keys for player 1 and the Archmage by clicking the picker for player 2 (both Human in the lobby, so both spawn at the Human base), who attacks with Space, presses L, clicks Storm Bolt on the spell bar, holds W and D, presses Tab, C, Z and X, takes a hot reload, presses 1, 2 and 3, holds A, switches cameras, swings with a click and Space, guards with Q, sends `-anim`, `-combo`, `-impact` and `-guard`, buffers a swing, walks with the guard up, recruits from the Human base's recruiter, free to both as kin, player 1 taking Footmen by key and player 2 Riflemen by a click (and failing to take them twice), skipping lines with Space, player 1 goes back to the recruiter and leaves with Esc, and makes the same native calls in both clients for 1000 frames. |

The map calls Warcraft's natives directly, which a map on Bun does not get
([headless](headless.md)), so its journey runs only in Lua. Headless units
take no orders and there are no unit or tree queries, so the journey checks
key handling, timers, messages and synchronization, not where units go or
what the camera shows; its `intentionalNoops` name each such native and why.

## Run it

From the Wisp checkout:

```sh
bun test examples/rps
bun examples/rps/scripts/rps.ts map build --base BASE.w3m --out OUT_DIR/wisp-rps.w3x
```

The base map follows the [sample map's rules](sample-map.md#the-base-map);
one with trees and hills shows the occlusion and terrain lift.

A melee map makes a good base: a format 31 one such as an 8-player ladder map
builds too (war3map.w3i format 31, [the base map](sample-map.md#the-base-map)),
and its gold mines become the outposts, guarded by its creep camps.
