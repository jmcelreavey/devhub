"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
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
 * Reordering runs on pointer events, not HTML5 drag-and-drop.
 *
 * WebKit refuses to start an element drag from a form control, so a
 * `<button draggable>` grip produced *zero* drag events in WKWebView — no
 * dragstart, no dragover, no drop. Chrome fired all of them, which is why this
 * looked fine in a browser and dead in the packaged desktop app.
 *
 * The move/up listeners live on `window` rather than on the grip, and the grip
 * deliberately does *not* call `setPointerCapture`. Capture looks like the right
 * tool and is a trap here: the live preview reorders keyed children, React moves
 * the grip's DOM node to its new position, and moving a node releases its
 * pointer capture. The drag then died on its own first successful reorder —
 * drag far enough to shift a row and it snapped back and stopped responding.
 * Window listeners do not care where the node ends up.
 */
const DRAG_THRESHOLD_PX = 4;

/** Kills text selection and holds the grabbing cursor for the whole drag. */
const DRAGGING_BODY_CLASS = "sortable-dragging";

/** A drop landing on another list's row, resolved by that list's own types. */
type ForeignDropHandler = (sourceId: string, targetId: string) => void;

interface SortableDragState {
  draggingId: string | null;
  overId: string | null;
  setDraggingId: (id: string | null) => void;
  setOverId: (id: string | null) => void;
  registerList: (uid: string, handler: ForeignDropHandler) => () => void;
  dropOnList: (uid: string, sourceId: string, targetId: string) => void;
}

const SortableDragContext = createContext<SortableDragState | null>(null);

/**
 * Shares one drag/drop highlight across every nested SortableList in a tree so
 * only a single target is ever highlighted, no matter how many levels deep the
 * cursor is. Without it, each nested list tracks its own `overId` and ancestor
 * folders stay highlighted as the cursor moves between levels.
 *
 * It also brokers drops that cross lists: the list holding the pointer cannot
 * know the target list's item type, so it hands the ids to the owning list.
 */
export function SortableDragProvider({ children }: { children: ReactNode }) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const lists = useRef(new Map<string, ForeignDropHandler>());

  const registerList = useCallback((uid: string, handler: ForeignDropHandler) => {
    lists.current.set(uid, handler);
    return () => {
      lists.current.delete(uid);
    };
  }, []);

  const dropOnList = useCallback((uid: string, sourceId: string, targetId: string) => {
    lists.current.get(uid)?.(sourceId, targetId);
  }, []);

  const value = useMemo(
    () => ({ draggingId, overId, setDraggingId, setOverId, registerList, dropOnList }),
    [draggingId, overId, registerList, dropOnList],
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

function sameOrder<T>(a: T[], b: T[], getId: (item: T) => string): boolean {
  return a.length === b.length && a.every((item, index) => getId(item) === getId(b[index]!));
}

/** The row under the pointer, in whichever list owns it. */
function rowAtPoint(x: number, y: number): { id: string; owner: string } | null {
  const hit = document.elementFromPoint(x, y);
  const row = hit?.closest<HTMLElement>("[data-sortable-id]");
  const id = row?.dataset.sortableId;
  const owner = row?.dataset.sortableOwner;
  return id && owner ? { id, owner } : null;
}

interface DragSession {
  sourceId: string;
  pointerId: number;
  originX: number;
  originY: number;
  started: boolean;
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
  const uid = useId();
  const [localDraggingId, setLocalDraggingId] = useState<string | null>(null);
  const [localOverId, setLocalOverId] = useState<string | null>(null);
  /** Live visual order while dragging — committed on drop, discarded on cancel. */
  const [previewItems, setPreviewItems] = useState<T[] | null>(null);
  const previewRef = useRef<T[] | null>(null);
  const session = useRef<DragSession | null>(null);
  /** Detaches the window listeners for the live gesture, if there is one. */
  const releaseGesture = useRef<(() => void) | null>(null);

  const draggingId = shared ? shared.draggingId : localDraggingId;
  const overId = shared ? shared.overId : localOverId;
  const setDraggingId = shared ? shared.setDraggingId : setLocalDraggingId;
  const setOverId = shared ? shared.setOverId : setLocalOverId;

  const displayItems = previewItems ?? items;

  const clearDragState = useCallback(() => {
    releaseGesture.current?.();
    session.current = null;
    previewRef.current = null;
    setPreviewItems(null);
    setDraggingId(null);
    setOverId(null);
  }, [setDraggingId, setOverId]);

  const reorderById = useCallback(
    (sourceId: string, targetId: string) => {
      const from = items.findIndex((item) => getId(item) === sourceId);
      const to = items.findIndex((item) => getId(item) === targetId);
      const next = moveItem(items, from, to);
      if (next !== items) onReorder(next);
    },
    [getId, items, onReorder],
  );

  /** Accepts an item dragged in from another list. */
  const acceptForeignDrop = useCallback(
    (sourceId: string, targetId: string) => {
      const target = items.find((item) => getId(item) === targetId);
      if (target) void onDropItem?.(sourceId, target, items);
    },
    [getId, items, onDropItem],
  );

  useEffect(() => {
    if (!shared) return;
    return shared.registerList(uid, acceptForeignDrop);
  }, [shared, uid, acceptForeignDrop]);

  const finishDrag = useCallback(
    (commit: boolean) => {
      const preview = previewRef.current;
      if (commit && preview && !sameOrder(preview, items, getId)) {
        onReorder(preview);
      }
      clearDragState();
    },
    [clearDragState, getId, items, onReorder],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      const active = session.current;
      if (!active || event.pointerId !== active.pointerId) return;

      if (!active.started) {
        const travelled =
          Math.abs(event.clientX - active.originX) + Math.abs(event.clientY - active.originY);
        if (travelled < DRAG_THRESHOLD_PX) return;
        active.started = true;
        setDraggingId(active.sourceId);
        previewRef.current = items;
        setPreviewItems(items);
      }

      const hit = rowAtPoint(event.clientX, event.clientY);
      if (!hit || hit.id === active.sourceId) return;

      if (hit.owner !== uid) {
        // Hovering another list — that list owns the drop, so just highlight.
        setOverId(hit.id);
        previewRef.current = items;
        setPreviewItems(items);
        return;
      }

      // The ref, not the state: these listeners are bound once per gesture, so
      // reading `previewItems` here would pin the drag to the order as it stood
      // at pointerdown and every move would recompute from the same start.
      const current = previewRef.current ?? items;
      const from = current.findIndex((item) => getId(item) === active.sourceId);
      const to = current.findIndex((item) => getId(item) === hit.id);
      const next = moveItem(current, from, to);
      if (next !== current) {
        previewRef.current = next;
        setPreviewItems(next);
      }
      setOverId(null);
    },
    [getId, items, setDraggingId, setOverId, uid],
  );

  const handlePointerUp = useCallback(
    (event: PointerEvent) => {
      const active = session.current;
      if (!active || event.pointerId !== active.pointerId) return;
      if (!active.started) {
        // A click on the grip, not a drag.
        clearDragState();
        return;
      }

      const hit = rowAtPoint(event.clientX, event.clientY);
      if (hit && hit.owner !== uid) {
        const sourceId = active.sourceId;
        const { owner, id } = hit;
        clearDragState();
        if (shared) shared.dropOnList(owner, sourceId, id);
        return;
      }
      finishDrag(true);
    },
    [clearDragState, finishDrag, shared, uid],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, id: string) => {
      if (disabled || event.button !== 0) return;
      // Keeps the press from starting a text selection or a native drag; the
      // threshold check in pointermove is what distinguishes a click.
      event.preventDefault();
      session.current = {
        sourceId: id,
        pointerId: event.pointerId,
        originX: event.clientX,
        originY: event.clientY,
        started: false,
      };

      // Bound here rather than in an effect so the gesture is live from this
      // event onwards, with no render in between for a fast pointer to fall
      // through. `items` does not change mid-drag — only the preview does, and
      // that is read from a ref — so binding once holds no stale data.
      const detach = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        releaseGesture.current = null;
      };
      const onMove = (moveEvent: PointerEvent) => handlePointerMove(moveEvent);
      const onUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== event.pointerId) return;
        detach();
        handlePointerUp(upEvent);
      };
      const onCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== event.pointerId) return;
        detach();
        finishDrag(false);
      };

      releaseGesture.current?.();
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      releaseGesture.current = detach;
    },
    [disabled, finishDrag, handlePointerMove, handlePointerUp],
  );

  // Unmounting mid-drag must not leave listeners on window.
  useEffect(() => () => releaseGesture.current?.(), []);

  // Suppress text selection and hold the grabbing cursor while a drag runs.
  useEffect(() => {
    if (!draggingId) return;
    document.body.classList.add(DRAGGING_BODY_CLASS);
    return () => document.body.classList.remove(DRAGGING_BODY_CLASS);
  }, [draggingId]);

  // Escape aborts without committing, matching every other drag in the app.
  useEffect(() => {
    if (!draggingId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finishDrag(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draggingId, finishDrag]);

  return (
    <>
      {/* react-hooks/refs traces the drag-session ref through `renderItem` and
          assumes it is read during render. It is not: the pointer handlers below
          only ever run from DOM events. */}
      {/* eslint-disable-next-line react-hooks/refs */}
      {displayItems.map((item, index) => {
        const id = getId(item);
        const isDragging = draggingId === id;
        // Live preview already moves the row; keep the outline for foreign drops.
        const isDropTarget = draggingId !== id && overId === id;

        return (
          <div key={id} data-sortable-id={id} data-sortable-owner={uid}>
            {renderItem(item, {
              isDragging,
              isDropTarget,
              dragHandleProps: {
                // Native drag stays off: WebKit will not start one from a
                // button, and a half-working second mechanism is worse than none.
                draggable: false,
                "data-sortable-handle": "",
                // Move/up/cancel are on `window` — see the note by
                // DRAG_THRESHOLD_PX for why they cannot live on this button.
                onPointerDown: disabled ? undefined : (e) => handlePointerDown(e, id),
                onKeyDown: disabled
                  ? undefined
                  : (e) => {
                      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                      e.preventDefault();
                      const targetIndex = e.key === "ArrowUp" ? index - 1 : index + 1;
                      const target = displayItems[targetIndex];
                      if (target) reorderById(id, getId(target));
                    },
                "aria-keyshortcuts": disabled ? undefined : "ArrowUp ArrowDown",
              } as SortableRenderState["dragHandleProps"],
            })}
          </div>
        );
      })}
    </>
  );
}
