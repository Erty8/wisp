// Runs the autochess map's registered tests in Lua.
import { runTests } from "wisp/src/runtime/testing";
import "../src/rules.tests";

if (runTests(print) > 0) os.exit(1);
