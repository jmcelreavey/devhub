import { z } from "zod";
import { runtimeAssetSchema, runtimeDigestSchema } from "./runtime-assets-schema.ts";
import { trustedThemePackEffectsSchema } from "./theme-effects-schema.ts";
import { themeAvailabilitySchema } from "./theme-availability-schema.ts";
import { themePaletteSchema } from "./theme-palette-schema.ts";

const slug = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/);
const reserved = new Set(["graphite", "forest", "midnight", "tokyo", "catppuccin", ...Object.getOwnPropertyNames(Object.prototype)]);
const image = runtimeAssetSchema.refine(asset => /\.(png|webp)$/.test(asset.path), "Use a static PNG or WebP image");
const sound = z.object({
  id: slug,
  asset: runtimeAssetSchema.refine(asset => asset.path.endsWith(".wav"), "Use a WAV sound"),
  volume: z.number().min(0).max(0.25),
  loop: z.boolean(),
  trigger: z.enum(["ambient", "effect", "gesture", "random"]),
  schedule: z.object({ initialMin: z.number().int().min(1).max(3600), initialMax: z.number().int().min(1).max(3600), min: z.number().int().min(1).max(3600), max: z.number().int().min(1).max(3600) }).strict().optional(),
  rate: z.tuple([z.number().min(0.5).max(2), z.number().min(0.5).max(2)]).optional(),
}).strict();
const staticLayer = z.object({
  id: slug,
  effect: z.string().min(1).max(40),
  placement: z.enum(["fill", "top", "canopy", "ornament", "room", "room-left", "room-right"]),
  opacity: z.number().min(0).max(1),
  mobileOpacity: z.number().min(0).max(1),
  asset: image,
  light: image,
}).strict();

export const runtimeThemeSchema = z.object({
  id: slug.refine(id => !reserved.has(id), "Core and object namespaces are reserved"),
  label: z.string().min(1).max(120),
  description: z.string().max(240),
  dark: themePaletteSchema,
  light: themePaletteSchema,
  availability: themeAvailabilitySchema.optional(),
  effects: trustedThemePackEffectsSchema.optional(),
  surface: runtimeAssetSchema.refine(asset => asset.path.endsWith(".html"), "Use a bundled HTML effect surface").optional(),
  staticImage: image.optional(),
  staticLayers: z.array(staticLayer).min(1).max(8).optional(),
  layer: z.enum(["background", "foreground"]).optional(),
  readableScene: z.literal(true).optional(),
  pointerEffects: z.array(z.string().min(1).max(40)).min(1).max(8).optional(),
  fogLayer: z.literal(true).optional(),
  staticSurface: z.literal(true).optional(),
  hostDecorations: z.object({ headingGlitch: z.literal(true).optional(), hoverCrack: z.literal(true).optional() }).strict().optional(),
  hostEffects: z.array(z.enum(["cursor", "celebrations"])).max(2).optional(),
  logo: image.optional(),
  font: runtimeAssetSchema.refine(asset => asset.path.endsWith(".woff2"), "Use a WOFF2 font").optional(),
  images: z.array(z.object({ id: slug, asset: image }).strict()).max(32).optional(),
  audio: z.array(sound).max(8).optional(),
}).strict().superRefine((theme, context) => {
  if ((theme.surface || theme.staticImage || theme.staticLayers) && !theme.effects) context.addIssue({ code: "custom", path: ["effects"], message: "Effect surfaces need declared preferences" });
  if (theme.readableScene && (!theme.surface || !theme.effects)) context.addIssue({ code: "custom", path: ["readableScene"], message: "Readable scenes need a surface and declared preferences" });
  if ((theme.fogLayer || theme.pointerEffects || theme.staticSurface) && !theme.readableScene) context.addIssue({ code: "custom", path: ["readableScene"], message: "Surface layers and pointer effects need a readable scene" });
  if (theme.staticSurface && (theme.staticImage || theme.staticLayers)) context.addIssue({ code: "custom", path: ["staticSurface"], message: "Choose one static scene format" });
  if (new Set(theme.pointerEffects).size !== (theme.pointerEffects?.length ?? 0) || theme.pointerEffects?.some(id => !theme.effects?.effects.some(effect => effect.id === id))) context.addIssue({ code: "custom", path: ["pointerEffects"], message: "Pointer effects must be uniquely declared in theme preferences" });
  if (theme.hostDecorations && !theme.effects?.effects.some(effect => effect.id === "interaction")) context.addIssue({ code: "custom", path: ["hostDecorations"], message: "Host decorations need a declared interaction effect" });
  if (theme.staticImage && theme.staticLayers) context.addIssue({ code: "custom", path: ["staticLayers"], message: "Choose one static scene format" });
  if (new Set(theme.staticLayers?.map(layer => layer.id)).size !== (theme.staticLayers?.length ?? 0)) context.addIssue({ code: "custom", path: ["staticLayers"], message: "Duplicate static layer id" });
  for (const [index, layer] of (theme.staticLayers ?? []).entries()) {
    const declaration = theme.effects?.effects.find(effect => effect.id === layer.effect);
    if (!declaration || declaration.reducedMotion === "off") context.addIssue({ code: "custom", path: ["staticLayers", index, "effect"], message: "Static layers need a declared reduced-motion effect" });
    if (layer.placement.startsWith("room") && !theme.readableScene) context.addIssue({ code: "custom", path: ["staticLayers", index, "placement"], message: "Room placements need a readable scene" });
  }
  if (new Set(theme.hostEffects).size !== (theme.hostEffects?.length ?? 0) || theme.hostEffects?.some(id => !theme.effects?.effects.some(effect => effect.id === id))) {
    context.addIssue({ code: "custom", path: ["hostEffects"], message: "Host effects must be uniquely declared in theme preferences" });
  }
  if (theme.audio?.length && !theme.effects?.effects.some(effect => effect.id === "sound" && !effect.default)) {
    context.addIssue({ code: "custom", path: ["audio"], message: "Sound must be declared and off by default" });
  }
  if (new Set(theme.audio?.map(sound => sound.id)).size !== (theme.audio?.length ?? 0)) context.addIssue({ code: "custom", path: ["audio"], message: "Duplicate sound id" });
  if (theme.audio?.some(sound => sound.trigger === "gesture" && sound.loop)) context.addIssue({ code: "custom", path: ["audio"], message: "Gesture sounds must not loop" });
  for (const [index, sound] of (theme.audio ?? []).entries()) {
    if ((sound.trigger === "random") !== Boolean(sound.schedule) || (sound.trigger === "random" && sound.loop)) context.addIssue({ code: "custom", path: ["audio", index], message: "Random sounds need a schedule and cannot loop" });
    if (sound.schedule && (sound.schedule.initialMin > sound.schedule.initialMax || sound.schedule.min > sound.schedule.max)) context.addIssue({ code: "custom", path: ["audio", index, "schedule"], message: "Schedule minimum exceeds maximum" });
    if (sound.rate && sound.rate[0] > sound.rate[1]) context.addIssue({ code: "custom", path: ["audio", index, "rate"], message: "Rate minimum exceeds maximum" });
  }
  if (new Set(theme.images?.map(image => image.id)).size !== (theme.images?.length ?? 0)) context.addIssue({ code: "custom", path: ["images"], message: "Duplicate image id" });
});
export const runtimeThemesSchema = z.array(runtimeThemeSchema).min(1).max(8).refine(themes => new Set(themes.map(theme => theme.id)).size === themes.length, "Duplicate theme id");
export const publicRuntimeThemeSchema = runtimeThemeSchema.safeExtend({ plugin: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/), revision: runtimeDigestSchema });
export const runtimeThemeCatalogSchema = z.object({
  themes: z.array(publicRuntimeThemeSchema).max(512),
  managedPlugins: z.array(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/)).max(512),
}).strict();
export type RuntimeTheme = z.infer<typeof runtimeThemeSchema>;
export type PublicRuntimeTheme = z.infer<typeof publicRuntimeThemeSchema>;
export type ThemeAssetKind = "html" | "image" | "font" | "audio";

export function runtimeThemeAssets(theme: RuntimeTheme) {
  const assets: { id: string; asset: z.infer<typeof runtimeAssetSchema>; kind: ThemeAssetKind }[] = [];
  if (theme.surface) assets.push({ id: "surface", asset: theme.surface, kind: "html" });
  if (theme.staticImage) assets.push({ id: "static", asset: theme.staticImage, kind: "image" });
  for (const layer of theme.staticLayers ?? []) {
    assets.push({ id: `static:${layer.id}`, asset: layer.asset, kind: "image" });
    assets.push({ id: `static:${layer.id}:light`, asset: layer.light, kind: "image" });
  }
  if (theme.logo) assets.push({ id: "logo", asset: theme.logo, kind: "image" });
  if (theme.font) assets.push({ id: "font", asset: theme.font, kind: "font" });
  for (const image of theme.images ?? []) assets.push({ id: `image:${image.id}`, asset: image.asset, kind: "image" });
  for (const sound of theme.audio ?? []) assets.push({ id: `audio:${sound.id}`, asset: sound.asset, kind: "audio" });
  return assets;
}

export function runtimeThemeAssetUrl(theme: PublicRuntimeTheme, asset: string): string {
  return `/api/plugins/themes/${encodeURIComponent(theme.plugin)}/${encodeURIComponent(theme.id)}?${new URLSearchParams({ revision: theme.revision, asset })}`;
}
