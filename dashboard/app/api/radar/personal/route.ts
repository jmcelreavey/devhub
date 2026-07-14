import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { withErrorHandler } from "@/lib/api-utils";
import { getNotesDir } from "@/lib/content-dirs";

export type RadarRing = "adopt" | "trial" | "assess" | "hold";

export interface PersonalRadarItem {
  ring: RadarRing;
  text: string;
}

export interface PersonalRadarPayload {
  path: string;
  exists: boolean;
  items: PersonalRadarItem[];
  markdown: string;
}

const RINGS: RadarRing[] = ["adopt", "trial", "assess", "hold"];

function parsePersonalRadar(md: string): PersonalRadarItem[] {
  const items: PersonalRadarItem[] = [];
  let ring: RadarRing | null = null;
  for (const line of md.split("\n")) {
    const heading = line.match(/^##\s+(Adopt|Trial|Assess|Hold)\s*$/i);
    if (heading) {
      ring = heading[1].toLowerCase() as RadarRing;
      continue;
    }
    if (!ring) continue;
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) items.push({ ring, text: bullet[1].trim() });
  }
  return items.filter((i) => RINGS.includes(i.ring));
}

export const GET = withErrorHandler(async () => {
  const rel = "radar/personal-radar.md";
  const abs = path.join(getNotesDir(), rel);
  const exists = fs.existsSync(abs);
  const markdown = exists ? fs.readFileSync(abs, "utf-8") : "";
  const items = exists ? parsePersonalRadar(markdown) : [];
  const payload: PersonalRadarPayload = { path: rel, exists, items, markdown };
  return NextResponse.json(payload);
}, "radar/personal");
