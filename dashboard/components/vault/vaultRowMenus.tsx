import {
  ClipboardCopy,
  Code2,
  Copy,
  FilePlus,
  FileText,
  Flame,
  FolderInput,
  FolderPlus,
  Pencil,
  Share2,
  Trash2,
} from "lucide-react";
import type { ContextMenuGroup } from "@/components/shell/ContextMenu";
import type { VaultRowKind } from "@/lib/vault/vault-file-actions";

const icon = { size: 12 as const };

export interface VaultFileMenuActions {
  itemLabel: string;
  kind: VaultRowKind;
  deleting?: boolean;
  onOpen: () => void;
  onOpenInCursor?: () => void;
  /** When set (and `onOpenInCursor` is missing), show Open in Cursor disabled. */
  cursorDisabledReason?: string;
  onCopyLocation: () => void;
  onCopyMarkdown?: () => void;
  onShare?: () => void;
  onOneTime?: () => void;
  onRename?: () => void;
  onDuplicate?: () => void;
  onMove?: () => void;
  onDelete: () => void;
}

export interface VaultFolderMenuActions {
  itemLabel: string;
  deleting?: boolean;
  onNewItem?: () => void;
  onNewFolder?: () => void;
  onCopyPath: () => void;
  onRename?: () => void;
  onMove?: () => void;
  onDelete?: () => void;
}

export function buildVaultFileMenuGroups(actions: VaultFileMenuActions): ContextMenuGroup[] {
  const openItems = [
    {
      id: "open",
      label: "Open",
      icon: <FileText {...icon} aria-hidden />,
      onSelect: actions.onOpen,
    },
    ...(actions.onOpenInCursor || actions.cursorDisabledReason
      ? [
          {
            id: "cursor",
            label: "Open in Cursor",
            description:
              actions.kind === "notes"
                ? "Opens with a linked repo if this note has one"
                : undefined,
            icon: <Code2 {...icon} aria-hidden />,
            disabled: !actions.onOpenInCursor,
            disabledReason: actions.onOpenInCursor ? undefined : actions.cursorDisabledReason,
            onSelect: actions.onOpenInCursor ?? (() => undefined),
          },
        ]
      : []),
  ];

  const fileItems = [
    {
      id: "copy",
      label: "Copy location",
      icon: <ClipboardCopy {...icon} aria-hidden />,
      onSelect: actions.onCopyLocation,
    },
    ...(actions.onCopyMarkdown
      ? [
          {
            id: "markdown",
            label: "Copy as Markdown",
            icon: <Copy {...icon} aria-hidden />,
            onSelect: actions.onCopyMarkdown,
          },
        ]
      : []),
    ...(actions.onShare
      ? [
          {
            id: "share",
            label: "Share",
            description: "Secret gist — link copied",
            icon: <Share2 {...icon} aria-hidden />,
            onSelect: actions.onShare,
          },
        ]
      : []),
    ...(actions.onOneTime
      ? [
          {
            id: "one-time",
            label: "One-time link",
            description: "Burn-after-reading PrivateBin share",
            icon: <Flame {...icon} aria-hidden />,
            onSelect: actions.onOneTime,
          },
        ]
      : []),
    ...(actions.onRename
      ? [
          {
            id: "rename",
            label: "Rename",
            icon: <Pencil {...icon} aria-hidden />,
            onSelect: actions.onRename,
          },
        ]
      : []),
    ...(actions.onDuplicate
      ? [
          {
            id: "duplicate",
            label: "Duplicate",
            icon: <Copy {...icon} aria-hidden />,
            onSelect: actions.onDuplicate,
          },
        ]
      : []),
    ...(actions.onMove
      ? [
          {
            id: "move",
            label: "Move",
            icon: <FolderInput {...icon} aria-hidden />,
            onSelect: actions.onMove,
          },
        ]
      : []),
  ];

  return [
    { id: "open", items: openItems },
    { id: "file", items: fileItems },
    {
      id: "danger",
      items: [
        {
          id: "delete",
          label: actions.deleting ? "Deleting…" : `Delete ${actions.itemLabel}`,
          icon: <Trash2 {...icon} aria-hidden />,
          danger: true,
          disabled: actions.deleting,
          onSelect: actions.onDelete,
        },
      ],
    },
  ];
}

export function buildVaultFolderMenuGroups(actions: VaultFolderMenuActions): ContextMenuGroup[] {
  const folderItems = [
    ...(actions.onNewItem
      ? [
          {
            id: "new",
            label: `New ${actions.itemLabel} here`,
            icon: <FilePlus {...icon} aria-hidden />,
            onSelect: actions.onNewItem,
          },
        ]
      : []),
    ...(actions.onNewFolder
      ? [
          {
            id: "new-folder",
            label: "New folder",
            icon: <FolderPlus {...icon} aria-hidden />,
            onSelect: actions.onNewFolder,
          },
        ]
      : []),
    {
      id: "copy",
      label: "Copy path",
      icon: <ClipboardCopy {...icon} aria-hidden />,
      onSelect: actions.onCopyPath,
    },
    ...(actions.onRename
      ? [
          {
            id: "rename",
            label: "Rename",
            icon: <Pencil {...icon} aria-hidden />,
            onSelect: actions.onRename,
          },
        ]
      : []),
    ...(actions.onMove
      ? [
          {
            id: "move",
            label: "Move",
            icon: <FolderInput {...icon} aria-hidden />,
            onSelect: actions.onMove,
          },
        ]
      : []),
  ];

  return [
    { id: "folder", items: folderItems },
    ...(actions.onDelete
      ? [
          {
            id: "danger",
            items: [
              {
                id: "delete-folder",
                label: actions.deleting ? "Deleting…" : "Delete folder",
                icon: <Trash2 {...icon} aria-hidden />,
                danger: true,
                disabled: actions.deleting,
                onSelect: actions.onDelete,
              },
            ],
          },
        ]
      : []),
  ];
}
