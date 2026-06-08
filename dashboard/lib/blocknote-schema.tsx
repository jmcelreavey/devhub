"use client";

import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { SharedChecklistBlockView } from "@/components/SharedChecklistBlock";
import { DiagramEmbedBlockView } from "@/components/DiagramEmbedBlock";
import { MermaidBlockView } from "@/components/MermaidBlock";
import { TaskRefBlockView } from "@/components/TaskRefBlock";

export const sharedChecklistBlockSpec = createReactBlockSpec(
  {
    type: "sharedChecklist",
    propSchema: {
      masterListId: { default: "" },
      entriesJson: { default: "[]" },
      width: { default: 0 },
    },
    content: "none",
  },
  {
    render: ({ block }) => (
      <SharedChecklistBlockView
        masterListId={block.props.masterListId}
        entriesJson={block.props.entriesJson}
        width={block.props.width}
        blockId={block.id}
      />
    ),
    toExternalHTML: ({ block }) => (
      <div
        data-devhub-shared-checklist-id={block.props.masterListId}
        data-devhub-entries={block.props.entriesJson}
      >
        Shared checklist
      </div>
    ),
  },
);

export const diagramEmbedBlockSpec = createReactBlockSpec(
  {
    type: "diagramEmbed",
    propSchema: {
      path: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block }) => (
      <DiagramEmbedBlockView path={block.props.path} blockId={block.id} />
    ),
    toExternalHTML: ({ block }) => (
      <div data-devhub-diagram-path={block.props.path}>Diagram: {block.props.path}</div>
    ),
  },
);

export const mermaidBlockSpec = createReactBlockSpec(
  {
    type: "mermaid",
    propSchema: {
      code: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block }) => <MermaidBlockView code={block.props.code} blockId={block.id} />,
    toExternalHTML: ({ block }) => (
      <pre>
        <code className="language-mermaid">{block.props.code}</code>
      </pre>
    ),
  },
);

export const taskRefBlockSpec = createReactBlockSpec(
  {
    type: "taskRef",
    propSchema: {
      taskId: { default: "" },
      date: { default: "" },
      label: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block }) => (
      <TaskRefBlockView
        taskId={block.props.taskId}
        date={block.props.date}
        label={block.props.label}
      />
    ),
    toExternalHTML: ({ block }) => (
      <div data-devhub-task-id={block.props.taskId}>{block.props.label}</div>
    ),
  },
);

export const devhubBlockNoteSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    sharedChecklist: sharedChecklistBlockSpec(),
    diagramEmbed: diagramEmbedBlockSpec(),
    mermaid: mermaidBlockSpec(),
    taskRef: taskRefBlockSpec(),
  },
});

export type DevHubBlock = typeof devhubBlockNoteSchema.Block;
export type DevHubPartialBlock = typeof devhubBlockNoteSchema.PartialBlock;
