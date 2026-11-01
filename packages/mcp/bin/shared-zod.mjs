import path from "node:path";

export function sharedZodPlugin(sharedRoot) {
  return {
    name: "shared-zod",
    setup(build) {
      build.onResolve({ filter: /^zod(?:\/.*)?$/ }, (args) => {
        if (!args.importer.startsWith(`${sharedRoot}${path.sep}`)) return;
        return { path: args.path, external: true };
      });
    },
  };
}
