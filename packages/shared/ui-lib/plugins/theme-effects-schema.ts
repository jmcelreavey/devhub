import { z } from "zod";

const effectId = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/)
  .refine(id => !["master", "motion", "constructor", "prototype"].includes(id), "Reserved effect id");
const trustedEffectId = z.string().regex(/^[a-z][a-zA-Z0-9-]{0,39}$/)
  .refine(id => !["master", "motion", "prototype", ...Object.getOwnPropertyNames(Object.prototype).map(name => name.toLowerCase())].includes(id.toLowerCase()), "Reserved effect id");
const text = z.string().trim().min(1).max(240);

function effectsSchema(idSchema: z.ZodType<string>) {
  return z.object({
    title: text,
    description: text,
    mark: z.enum(["dock", "hollow", "ember", "sonar", "lantern", "petal", "brand"]),
    taskMessage: text,
    mergeMessage: text,
    effects: z.array(z.object({
      id: idSchema,
      label: text,
      description: text,
      default: z.boolean(),
      group: z.enum(["Atmosphere", "Feedback", "Pointer", "Extras"]),
      reducedMotion: z.enum(["static", "off", "unchanged"]),
      requires: z.array(idSchema).max(16).optional(),
    }).strict()).min(1).max(16),
  }).strict().superRefine((declaration, context) => {
    const ids = new Set(declaration.effects.map(effect => effect.id.toLowerCase()));
    if (ids.size !== declaration.effects.length) {
      context.addIssue({ code: "custom", message: "Effect ids must be unique", path: ["effects"] });
    }
    declaration.effects.forEach((effect, index) => {
      for (const required of effect.requires ?? []) {
        const dependency = declaration.effects.find(candidate => candidate.id === required);
        if (!dependency || required === effect.id || dependency.requires?.length) {
          context.addIssue({
            code: "custom",
            message: "Dependencies must name another declared effect without its own dependencies",
            path: ["effects", index, "requires"],
          });
        }
      }
    });
  });
}

export const pluginThemeEffectsSchema = effectsSchema(effectId);
export const trustedThemePackEffectsSchema = effectsSchema(trustedEffectId);

export const themePackEffectsSchema = pluginThemeEffectsSchema.superRefine((declaration, context) => {
  declaration.effects.forEach((effect, index) => {
    if (!(["cursor", "celebrations"] as readonly string[]).includes(effect.id)) {
      context.addIssue({ code: "custom", path: ["effects", index, "id"], message: "Theme packs support only host-rendered cursor and celebrations effects" });
    }
    if (effect.reducedMotion !== "off") {
      context.addIssue({ code: "custom", path: ["effects", index, "reducedMotion"], message: "Host-rendered effects must be off under reduced motion" });
    }
  });
});
