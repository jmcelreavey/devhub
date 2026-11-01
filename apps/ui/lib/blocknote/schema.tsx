"use client";

import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { diagramEmbedConfig, mermaidConfig, sharedChecklistConfig, taskRefConfig } from "@shared/blocknote/schema";
import { SharedChecklistBlockView } from "@/components/tasks/SharedChecklistBlock";
import { DiagramEmbedBlockView } from "@/components/diagrams/DiagramEmbedBlock";
import { MermaidBlockView } from "@/components/diagrams/MermaidBlock";
import { TaskRefBlockView } from "@/components/tasks/TaskRefBlock";

export const sharedChecklistBlockSpec = createReactBlockSpec(
  sharedChecklistConfig,
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
  diagramEmbedConfig,
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
  mermaidConfig,
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
  taskRefConfig,
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

export type { DevHubBlock, DevHubPartialBlock } from "@shared/blocknote/schema";
