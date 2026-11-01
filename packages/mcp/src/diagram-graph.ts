/**
 * Declarative graph -> tldraw records.
 *
 * The model describes *what* the system is (nodes, edges, groups); this module owns
 * *where* everything goes. That split matters because the model cannot measure text â
 * every diagram laid out by guessing coordinates ends up overlapping.
 *
 * Layout is a small Sugiyama: longest-path layering, barycenter ordering to cut
 * crossings, then coordinate assignment against measured node heights.
 */

import { geoHeight, indexKeyAt, measureLabel } from "./diagram-geometry.ts";

export type GraphDirection = "right" | "down";

export interface GraphNode {
  id: string;
  label: string;
  group?: string;
  color?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
}

export interface GraphGroup {
  id: string;
  label?: string;
  color?: string;
}

export interface GraphSpec {
  nodes: GraphNode[];
  edges?: GraphEdge[];
  groups?: GraphGroup[];
  direction?: GraphDirection;
  title?: string;
}

export interface LaidOutNode extends GraphNode {
  x: number;
  y: number;
  w: number;
  h: number;
  layer: number;
}

export interface GraphLayout {
  nodes: LaidOutNode[];
  bounds: { x: number; y: number; w: number; h: number };
}

const NODE_WIDTH = 260;
const LAYER_GAP = 140;
const SIBLING_GAP = 56;
const GROUP_PADDING = 32;
const GROUP_LABEL_HEIGHT = 36;
/** Vertical space between swimlanes â must clear GROUP_PADDING on both bands plus a label. */
const LANE_GAP = 128;
const TITLE_HEIGHT = 60;

const VALID_COLORS = new Set([
  "black",
  "grey",
  "light-violet",
  "violet",
  "blue",
  "light-blue",
  "yellow",
  "orange",
  "green",
  "light-green",
  "light-red",
  "red",
  "white",
]);

const color = (value: string | undefined, fallback: string): string =>
  value && VALID_COLORS.has(value) ? value : fallback;

const richText = (text: string): Record<string, unknown> => ({
  type: "doc",
  attrs: { dir: "auto" },
  content: text.split("\n").map((line) => ({
    type: "paragraph",
    attrs: { dir: "auto" },
    content: line ? [{ type: "text", text: line }] : [],
  })),
});

/**
 * Longest-path layering. Back edges (those that would revisit a node still on the DFS
 * stack) are dropped for layering purposes so cycles degrade to a sensible order rather
 * than looping forever.
 */
const assignLayers = (nodes: GraphNode[], edges: GraphEdge[]): Map<string, number> => {
  const ids = new Set(nodes.map((n) => n.id));
  const outgoing = new Map<string, string[]>();
  for (const id of ids) outgoing.set(id, []);
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) continue;
    outgoing.get(edge.from)?.push(edge.to);
  }

  const layers = new Map<string, number>();
  const onStack = new Set<string>();

  const visit = (id: string): number => {
    const known = layers.get(id);
    if (known !== undefined) return known;
    if (onStack.has(id)) return 0;

    onStack.add(id);
    let depth = 0;
    for (const next of outgoing.get(id) ?? []) {
      depth = Math.max(depth, visit(next) + 1);
    }
    onStack.delete(id);
    layers.set(id, depth);
    return depth;
  };

  for (const node of nodes) visit(node.id);

  // visit() measures distance to a sink; flip it so sources land in layer 0.
  const deepest = Math.max(0, ...layers.values());
  const flipped = new Map<string, number>();
  for (const [id, depth] of layers) flipped.set(id, deepest - depth);
  return flipped;
};

/** One barycenter sweep per direction â enough to untangle typical service graphs. */
const orderWithinLayers = (
  buckets: Map<number, GraphNode[]>,
  edges: GraphEdge[],
  layers: Map<string, number>,
): void => {
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  const link = (map: Map<string, string[]>, key: string, value: string): void => {
    const existing = map.get(key);
    if (existing) existing.push(value);
    else map.set(key, [value]);
  };
  for (const edge of edges) {
    if (!layers.has(edge.from) || !layers.has(edge.to)) continue;
    link(incoming, edge.to, edge.from);
    link(outgoing, edge.from, edge.to);
  }

  const positions = new Map<string, number>();
  const reindex = (): void => {
    for (const bucket of buckets.values()) {
      bucket.forEach((node, index) => positions.set(node.id, index));
    }
  };
  reindex();

  const barycenter = (id: string, neighbours: Map<string, string[]>, fallback: number): number => {
    const linked = neighbours.get(id) ?? [];
    if (linked.length === 0) return fallback;
    const sum = linked.reduce((total, other) => total + (positions.get(other) ?? 0), 0);
    return sum / linked.length;
  };

  const sweep = (order: number[], neighbours: Map<string, string[]>): void => {
    for (const layer of order) {
      const bucket = buckets.get(layer);
      if (!bucket) continue;
      const keyed = bucket.map((node, index) => ({
        node,
        key: barycenter(node.id, neighbours, index),
        index,
      }));
      keyed.sort((a, b) => a.key - b.key || a.index - b.index);
      buckets.set(
        layer,
        keyed.map((entry) => entry.node),
      );
      reindex();
    }
  };

  const ascending = [...buckets.keys()].sort((a, b) => a - b);
  sweep(ascending, incoming);
  sweep([...ascending].reverse(), outgoing);
};

/** Nodes sharing a group are pulled adjacent so the group background stays a tight box. */
const clusterByGroup = (bucket: GraphNode[]): GraphNode[] => {
  const seen: string[] = [];
  const byGroup = new Map<string, GraphNode[]>();
  for (const node of bucket) {
    const key = node.group ?? `\0${node.id}`;
    if (!byGroup.has(key)) {
      byGroup.set(key, []);
      seen.push(key);
    }
    byGroup.get(key)?.push(node);
  }
  return seen.flatMap((key) => byGroup.get(key) ?? []);
};

/**
 * Lane order: declared groups first (so the caller controls the reading order), then any
 * group only seen on a node, and finally the unlabelled lane for ungrouped nodes.
 */
const laneOrder = (spec: GraphSpec): string[] => {
  const lanes: string[] = [];
  for (const group of spec.groups ?? []) if (!lanes.includes(group.id)) lanes.push(group.id);
  for (const node of spec.nodes) {
    if (node.group && !lanes.includes(node.group)) lanes.push(node.group);
  }
  if (spec.nodes.some((node) => !node.group)) lanes.push("");
  return lanes;
};

export const layoutGraph = (spec: GraphSpec): GraphLayout => {
  const direction = spec.direction ?? "right";
  const edges = spec.edges ?? [];
  const layers = assignLayers(spec.nodes, edges);

  const buckets = new Map<number, GraphNode[]>();
  for (const node of spec.nodes) {
    const layer = layers.get(node.id) ?? 0;
    if (!buckets.has(layer)) buckets.set(layer, []);
    buckets.get(layer)?.push(node);
  }

  orderWithinLayers(buckets, edges, layers);
  for (const [layer, bucket] of buckets) buckets.set(layer, clusterByGroup(bucket));

  const heights = new Map<string, number>();
  for (const node of spec.nodes) heights.set(node.id, geoHeight(node.label, NODE_WIDTH));

  const ordered = [...buckets.keys()].sort((a, b) => a - b);
  const alongFlow = (node: GraphNode): number =>
    direction === "right" ? NODE_WIDTH : (heights.get(node.id) ?? 0);
  const acrossFlow = (node: GraphNode): number =>
    direction === "right" ? (heights.get(node.id) ?? 0) : NODE_WIDTH;

  // Flow axis: one slot per layer, sized by the deepest node in that layer.
  const flowStart = new Map<number, number>();
  let flowCursor = 0;
  for (const layer of ordered) {
    flowStart.set(layer, flowCursor);
    const bucket = buckets.get(layer) ?? [];
    flowCursor += Math.max(0, ...bucket.map(alongFlow)) + LAYER_GAP;
  }

  // Cross axis: one lane per group, tall enough for its busiest layer. Lanes never
  // overlap, which is the whole point â bounding-box groups do, badly, once a group
  // spans more than a couple of layers.
  const lanes = laneOrder(spec);
  const stackExtent = (lane: string, layer: number): number => {
    const members = (buckets.get(layer) ?? []).filter((node) => (node.group ?? "") === lane);
    if (members.length === 0) return 0;
    return (
      members.reduce((total, node) => total + acrossFlow(node), 0) +
      (members.length - 1) * SIBLING_GAP
    );
  };
  const laneExtent = (lane: string): number =>
    Math.max(0, ...ordered.map((layer) => stackExtent(lane, layer)));

  const laneStart = new Map<string, number>();
  const top = spec.title ? TITLE_HEIGHT : 0;
  let laneCursor = top;
  for (const lane of lanes) {
    laneStart.set(lane, laneCursor);
    laneCursor += laneExtent(lane) + LANE_GAP;
  }

  const placed: LaidOutNode[] = [];
  for (const layer of ordered) {
    const bucket = buckets.get(layer) ?? [];
    const cursors = new Map<string, number>();

    for (const node of bucket) {
      const lane = node.group ?? "";
      const start = laneStart.get(lane) ?? top;
      // Centre a short stack inside its lane so lanes read as bands, not ragged rows.
      const offset = cursors.get(lane) ?? (laneExtent(lane) - stackExtent(lane, layer)) / 2;
      const along = flowStart.get(layer) ?? 0;
      const h = heights.get(node.id) ?? 0;

      placed.push({
        ...node,
        x: direction === "right" ? along : start + offset,
        y: direction === "right" ? start + offset : along,
        w: NODE_WIDTH,
        h,
        layer,
      });
      cursors.set(lane, offset + acrossFlow(node) + SIBLING_GAP);
    }
  }

  const bounds = {
    x: Math.min(0, ...placed.map((n) => n.x)),
    y: Math.min(0, ...placed.map((n) => n.y)),
    w: Math.max(0, ...placed.map((n) => n.x + n.w)),
    h: Math.max(0, ...placed.map((n) => n.y + n.h)),
  };

  return { nodes: placed, bounds };
};

let sequence = 0;
const nextId = (prefix: string): string => {
  sequence += 1;
  return `${prefix}:g${Date.now().toString(36)}${sequence.toString(36)}`;
};

/** tldraw sorts shapes by `index`, which must be a valid ascending fractional-index key. */
const indexAt = indexKeyAt;

/**
 * Build the full record set for a graph. Group backgrounds are emitted first so they
 * sort behind their members, then nodes, then arrows on top.
 */
export const buildGraphRecords = (spec: GraphSpec): Record<string, unknown> => {
  const layout = layoutGraph(spec);
  const records: Record<string, unknown> = {};
  const shapeIds = new Map<string, string>();
  let index = 0;

  const base = (id: string, x: number, y: number, type: string, props: Record<string, unknown>) => ({
    x,
    y,
    rotation: 0,
    isLocked: false,
    opacity: 1,
    meta: {},
    id,
    type,
    props,
    parentId: "page:page",
    index: indexAt(index++),
    typeName: "shape",
  });

  // 1. Lane bands. Each group gets one band spanning the full flow axis, so bands stack
  //    without ever overlapping each other.
  const groupsById = new Map((spec.groups ?? []).map((group) => [group.id, group]));
  const groupKeys = [...new Set(layout.nodes.map((node) => node.group).filter(Boolean))] as string[];

  for (const key of groupKeys) {
    const members = layout.nodes.filter((node) => node.group === key);
    if (members.length === 0) continue;
    const definition = groupsById.get(key);
    // Bands own a horizontal slice of the cross axis, so they can never overlap each
    // other vertically. Along the flow axis we hug the members â stretching every band
    // to the full canvas width just paints acres of empty rectangle.
    const left = Math.min(...members.map((m) => m.x)) - GROUP_PADDING;
    const topEdge = Math.min(...members.map((m) => m.y)) - GROUP_PADDING - GROUP_LABEL_HEIGHT;
    const right = Math.max(...members.map((m) => m.x + m.w)) + GROUP_PADDING;
    const bottom = Math.max(...members.map((m) => m.y + m.h)) + GROUP_PADDING;

    const id = nextId("shape");
    records[id] = base(id, left, topEdge, "geo", {
      geo: "rectangle",
      flipX: false,
      flipY: false,
      dash: "dashed",
      url: "",
      w: right - left,
      h: bottom - topEdge,
      growY: 0,
      scale: 1,
      labelColor: "black",
      color: color(definition?.color, "grey"),
      fill: "none",
      size: "s",
      font: "draw",
      align: "start",
      verticalAlign: "start",
      richText: richText(definition?.label ?? key),
    });
  }

  // 2. Nodes.
  for (const node of layout.nodes) {
    const id = nextId("shape");
    shapeIds.set(node.id, id);
    records[id] = base(id, node.x, node.y, "geo", {
      geo: "rectangle",
      flipX: false,
      flipY: false,
      dash: "solid",
      url: "",
      w: node.w,
      h: node.h,
      growY: 0,
      scale: 1,
      labelColor: "black",
      color: color(node.color, "blue"),
      fill: "semi",
      size: "m",
      font: "draw",
      align: "middle",
      verticalAlign: "middle",
      richText: richText(node.label),
    });
  }

  // 3. Arrows, bound to their endpoints so they stay attached when shapes move.
  for (const edge of spec.edges ?? []) {
    const fromShape = shapeIds.get(edge.from);
    const toShape = shapeIds.get(edge.to);
    if (!fromShape || !toShape) continue;

    const from = layout.nodes.find((n) => n.id === edge.from);
    const to = layout.nodes.find((n) => n.id === edge.to);
    if (!from || !to) continue;

    const id = nextId("shape");
    records[id] = base(id, from.x + from.w, from.y + from.h / 2, "arrow", {
      kind: "arc",
      labelColor: "black",
      color: "black",
      fill: "none",
      dash: edge.dashed ? "dashed" : "draw",
      size: "s",
      arrowheadStart: "none",
      arrowheadEnd: "arrow",
      font: "draw",
      start: { x: 0, y: 0 },
      end: { x: to.x - (from.x + from.w), y: to.y + to.h / 2 - (from.y + from.h / 2) },
      bend: 0,
      richText: richText(edge.label ?? ""),
      labelPosition: 0.5,
      scale: 1,
      elbowMidPoint: 0.5,
    });

    for (const [terminal, target] of [
      ["start", fromShape],
      ["end", toShape],
    ] as const) {
      const bindingId = nextId("binding");
      records[bindingId] = {
        id: bindingId,
        typeName: "binding",
        type: "arrow",
        fromId: id,
        toId: target,
        meta: {},
        props: {
          terminal,
          normalizedAnchor: { x: 0.5, y: 0.5 },
          isExact: false,
          isPrecise: false,
          snap: "none",
        },
      };
    }
  }

  // 4. Title.
  if (spec.title) {
    const id = nextId("shape");
    const width = measureLabel(spec.title, { size: "xl", maxWidth: 2000 }).width;
    records[id] = base(id, 0, -TITLE_HEIGHT, "text", {
      color: "black",
      size: "xl",
      font: "draw",
      textAlign: "start",
      w: Math.ceil(width),
      richText: richText(spec.title),
      scale: 1,
      autoSize: true,
    });
  }

  return records;
};
