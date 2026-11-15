import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const mocks = new URL("../mocks/", import.meta.url);
const MAP = {
  "expo-sqlite": "expo-sqlite.ts",
  "expo-file-system": "expo-file-system.ts",
  "expo-crypto": "expo-crypto.ts",
  "react-native": "react-native.ts",
  "@react-native-community/netinfo": "netinfo.ts",
  "react-native-ble-manager": "ble-manager.ts",
  "convex/browser": "convex-browser.ts",
  "convex/react": "convex-react.ts",
};

export async function resolve(specifier, context, next) {
  if (MAP[specifier]) return { url: new URL(MAP[specifier], mocks).href, shortCircuit: true };
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const base = new URL(specifier, context.parentURL);
    const p = fileURLToPath(base);
    if (!/\.[cm]?[jt]sx?$/.test(p)) {
      for (const ext of [".ts", ".tsx", "/index.ts"]) {
        if (existsSync(p + ext)) return { url: pathToFileURL(p + ext).href, shortCircuit: true };
      }
    }
  }
  return next(specifier, context);
}
