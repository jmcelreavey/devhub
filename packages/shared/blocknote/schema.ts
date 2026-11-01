import type { Block, DefaultBlockSchema, PartialBlock } from "@blocknote/core";

export const sharedChecklistConfig = {
  type: "sharedChecklist",
  propSchema: {
    masterListId: { default: "" },
    entriesJson: { default: "[]" },
    width: { default: 0 },
  },
  content: "none",
} as const;

export const diagramEmbedConfig = {
  type: "diagramEmbed",
  propSchema: { path: { default: "" } },
  content: "none",
} as const;

export const mermaidConfig = {
  type: "mermaid",
  propSchema: { code: { default: "" } },
  content: "none",
} as const;

export const taskRefConfig = {
  type: "taskRef",
  propSchema: {
    taskId: { default: "" },
    date: { default: "" },
    label: { default: "" },
  },
  content: "none",
} as const;

type DevHubBlockSchema = DefaultBlockSchema & {
  sharedChecklist: typeof sharedChecklistConfig;
  diagramEmbed: typeof diagramEmbedConfig;
  mermaid: typeof mermaidConfig;
  taskRef: typeof taskRefConfig;
};

export type DevHubBlock = Block<DevHubBlockSchema>;
export type DevHubPartialBlock = PartialBlock<DevHubBlockSchema>;
