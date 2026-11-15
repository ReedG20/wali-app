// Registers the test resolver: maps native/Expo modules to in-process fakes and lets source files
// import siblings without the ".ts" extension (as Metro does).
import { register } from "node:module";
register("./loader.mjs", import.meta.url);
