import { build } from "esbuild";
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  platform: "node",
  format: "esm",
  bundle: true,
  packages: "external",
  target: "node24",
});
await build({
  entryPoints: ["src/control-ui.ts"],
  outfile: "dist/control-ui/index.js",
  platform: "browser",
  format: "esm",
  bundle: true,
  target: "es2023",
});
