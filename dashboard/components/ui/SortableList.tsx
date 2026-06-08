"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";

export interface SortableRenderState {
  dragHandleProps: HTMLAttributes<HTMLButtonElement> & { draggable: boolean };
  isDragging: boolean;
  isDropTarget: boolean;
}

export interface SortableListProps<T> {
  items: T[];
  getId: (item: T) => string;
  onReorder: (items: T[]) => void;
  renderItem: (item: T, state: SortableRenderState) => ReactNode;
  onDropItem?: (sourceId: string, targetItem: T, items: T[]) => boolean | void | Promise<boolean | void>;
  disabled?: boolean;
}

/**
 * Native drag events are reused as they bubble through nested lists. We tag the
 * event once the deepest list has claimed it so ancestor lists skip it — giving
 * "innermost target wins" without stopPropagation (which would kill the drop).
 */
interface DragOverMarker {
  __sortableOverHandled?: boolean;
  __sortableDropHandled?: boolean;
}

interface SortableDragState {
  draggingId: string | null;
  overId: string | null;
  setDraggingId: (id: string | null) => void;
  setOverId: (id: string | null) => void;
}

const SortableDragContext = createContext<SortableDragState | null>(null);

/**
 * Shares one drag/drop highlight across every nested SortableList in a tree so
 * only a single target is ever highlighted, no matter how many levels deep the
 * cursor is. Without it, each nested list tracks its own `overId` and ancestor
 * folders stay highlighted as the cursor moves between levels.
 */
export function SortableDragProvider({ children }: { children: ReactNode }) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const value = useMemo(
    () => ({ draggingId, overId, setDraggingId, setOverId }),
    [draggingId, overId],
  );
  return <SortableDragContext.Provider value={value}>{children}</SortableDragContext.Provider>;
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return items;
  }
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (!item) return items;
  next.splice(to, 0, item);
  return next;
}

export function SortableList<T>({
  items,
  getId,
  onReorder,
  renderItem,
  onDropItem,
  disabled = false,
}: SortableListProps<T>) {
  const shared = useContext(SortableDragContext);
  const [localDraggingId, setLocalDraggingId] = useState<string | null>(null);
  const [localOverId, setLocalOverId] = useState<string | null>(null);

  const draggingId = shared ? shared.draggingId : localDraggingId;
  const overId = shared ? shared.overId : localOverId;
  const setDraggingId = shared ? shared.setDraggingId : setLocalDraggingId;
  const setOverId = shared ? shared.setOverId : setLocalOverId;

  const finishDrag = () => {
    setDraggingId(null);
    setOverId(null);
  };

  const reorderById = (sourceId: string, targetId: string) => {
    const from = items.findIndex((item) => getId(item) === sourceId);
    const to = items.findIndex((item) => getId(item) === targetId);
    const next = moveItem(items, from, to);
    if (next !== items) onReorder(next);
  };

  return (
    <>
      {items.map((item, index) => {
        const id = getId(item);
        const isDragging = draggingId === id;
        const isDropTarget = draggingId !== id && overId === id;

        return (
          <div
            key={id}
            onDragOver={disabled ? undefined : (e) => {
              // preventDefault on every level keeps the drop a valid native drop
              // target. We must NOT stopPropagation — doing so breaks the native
              // drop event. Instead the innermost handler (which fires first as
              // the event bubbles) claims the highlight and ancestors back off.
              e.preventDefault();
              const marked = e.nativeEvent as DragOverMarker;
              if (marked.__sortableOverHandled) return;
              marked.__sortableOverHandled = true;
              if (draggingId !== id) setOverId(id);
            }}
            onDrop={disabled ? undefined : (e) => {
              e.preventDefault();
              const marked = e.nativeEvent as DragOverMarker;
              if (marked.__sortableDropHandled) {
                finishDrag();
                return;
              }
              marked.__sortableDropHandled = true;
              const sourceId = e.dataTransfer.getData("text/plain") || draggingId;
              if (!sourceId || sourceId === id) {
                finishDrag();
                return;
              }
              if (items.some((candidate) => getId(candidate) === sourceId)) {
                reorderById(sourceId, id);
              } else {
                void onDropItem?.(sourceId, item, items);
              }
              finishDrag();
            }}
          >
            {renderItem(item, {
              isDragging,
              isDropTarget,
              dragHandleProps: {
                draggable: !disabled,
                onDragStart: disabled ? undefined : (e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", id);
                  setDraggingId(id);
                },
                onDragEnd: disabled ? undefined : finishDrag,
                onKeyDown: disabled ? undefined : (e) => {
                  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                  e.preventDefault();
                  const targetIndex = e.key === "ArrowUp" ? index - 1 : index + 1;
                  const target = items[targetIndex];
                  if (target) reorderById(id, getId(target));
                },
                "aria-keyshortcuts": "ArrowUp ArrowDown",
              },
            })}
          </div>
        );
      })}
    </>
  );
}
