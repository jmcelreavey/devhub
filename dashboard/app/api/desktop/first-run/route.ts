import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import { getAppDataDir, isDesktopRuntime } from "@/lib/desktop/runtime-paths";
import { detectElectronInstall, readMigrationRecord } from "@/lib/desktop/migration";

/**
 * Has this installation finished first-run setup?
 *
 * Stored in app data rather than `localStorage`, which is the point. The
 * webview's storage is scoped to an origin and lives in a cache directory —
 * clearing website data, a corrupted profile, or an OS cache sweep would all
 * silently re-run onboarding for someone who completed it months ago. Whether
 * setup is done is a property of the installation, so it lives with the
 * installation's other state.
 */
export const dynamic = "force-dynamic";

interface FirstRunState {
  completed: boolean;
  completedAt: string | null;
  /** Goals chosen during onboarding; used to filter steps on a later visit. */
  goals: string[];
  /** Steps the user explicitly skipped, so the Ready screen can list them. */
  skipped: string[];
}

function stateFile(): string {
  return path.join(getAppDataDir(), "config", "first-run.json");
}

function read(): FirstRunState {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(), "utf-8")) as Partial<FirstRunState>;
    return {
      completed: Boolean(parsed.completed),
      completedAt: parsed.completedAt ?? null,
      goals: Array.isArray(parsed.goals) ? parsed.goals : [],
      skipped: Array.isArray(parsed.skipped) ? parsed.skipped : [],
    };
  } catch {
    return { completed: false, completedAt: null, goals: [], skipped: [] };
  }
}

export async function GET() {
  const state = read();
  // Offering migration is only meaningful before setup is finished; after
  // that it lives in Settings, where it is a deliberate action rather than a
  // surprise on launch.
  const migrationAvailable =
    isDesktopRuntime() && !state.completed && detectElectronInstall() !== null;

  return NextResponse.json({
    ...state,
    desktop: isDesktopRuntime(),
    migrationAvailable,
    migrated: readMigrationRecord() !== null,
  });
}

const SaveSchema = z.object({
  completed: z.boolean().optional(),
  goals: z.array(z.string().max(40)).max(10).optional(),
  skipped: z.array(z.string().max(40)).max(40).optional(),
});

/**
 * Saved after each step, not only at the end.
 *
 * Onboarding that loses everything when you quit halfway through is onboarding
 * you start again from the beginning, and people do not start again.
 */
export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, SaveSchema);
  if (!parsed.ok) return parsed.response;

  const current = read();
  const next: FirstRunState = {
    completed: parsed.data.completed ?? current.completed,
    completedAt:
      parsed.data.completed && !current.completed
        ? new Date().toISOString()
        : current.completedAt,
    goals: parsed.data.goals ?? current.goals,
    skipped: parsed.data.skipped ?? current.skipped,
  };

  const file = stateFile();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });

  return NextResponse.json({ ok: true, ...next });
}
