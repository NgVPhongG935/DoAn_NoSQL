import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import ts from "typescript";

// Keep application auth, routes, repositories and services real. Replace only
// request cookies, the Cassandra transport and the external maps provider.
const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = (name) => new URL(`./support/${name}.mjs`, import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") return { url: fixture("cookies"), shortCircuit: true };
    if (specifier === "cassandra-driver") return { url: fixture("cassandra"), shortCircuit: true };
    if (specifier === "@/services/maps") return { url: fixture("maps"), shortCircuit: true };
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier.startsWith("@/")) {
      return { url: pathToFileURL(path.join(root, "src", `${specifier.slice(2)}.ts`)).href, shortCircuit: true };
    }
    if (context.parentURL?.endsWith("/src/instrumentation.ts") && specifier === "./lib/security-config") {
      return { url: pathToFileURL(path.join(root, "src/lib/security-config.ts")).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".ts") && url.startsWith(pathToFileURL(path.join(root, "src")).href)) {
      const source = ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        fileName: fileURLToPath(url),
      }).outputText;
      return { format: "module", source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
