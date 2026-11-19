// Runs the rps map's registered tests in Lua.
import { runTests } from "wisp/src/runtime/testing";
import "../src/rules.tests";
import "../src/layout.tests";
import "../src/combat.tests";
import "../src/roster.tests";
import "../src/dialogue.tests";
import "../src/killcam.tests";
import "../src/quests.tests";
import "../src/journal.tests";
import "../src/units.tests";

if (runTests(print) > 0) os.exit(1);
