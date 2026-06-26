import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { blocksToText, textToBlocks } from "../convert.ts";
import * as appraisal from "../appraisal.ts";

export function registerAppraisalTools(server: McpServer, ctx: Context): void {
  const { storage } = ctx;

  /** Read a subject/year appraisal note as markdown, or a fresh skeleton if absent. */
  function readAppraisalMd(
    subject: string | undefined,
    year: string,
  ): { path: string; md: string; exists: boolean } {
    const filePath = appraisal.subjectYearPath(subject, year);
    const note = storage.read(filePath);
    if (!note) {
      return { path: filePath, md: appraisal.skeleton(subject, year), exists: false };
    }
    const blocks = note.content as unknown[];
    return { path: filePath, md: blocksToText(Array.isArray(blocks) ? blocks : [blocks]), exists: true };
  }

  function writeAppraisalMd(filePath: string, md: string): void {
    storage.write(filePath, textToBlocks(md));
  }

  server.registerTool(
    "appraisal_record",
    {
      description:
        "Record a noteworthy moment for performance review. Creates/updates a per-year note under appraisal/, organised by theme. Dedups by slug (update in place). Use for your own self-appraisal (subject defaults to 'self') or for someone you appraise (subject = their name).",
      inputSchema: {
        subject: z.string().optional().describe("'self' (default) or a person name/slug you appraise"),
        title: z.string().describe("Short entry title, e.g. 'Cut CI pipeline time 22→9 min'"),
        theme: z.enum(appraisal.THEMES).describe("impact | technical | collaboration | growth"),
        summary: z.string().describe("1-3 factual sentences: what happened + impact/evidence"),
        references: z
          .array(z.string())
          .min(1)
          .describe("URLs or refs (PR, ticket, dashboard, thread). At least one required."),
        goal: z.string().optional().describe("Slug of a goal this advances (see appraisal_set_goal)"),
        tags: z.array(z.string()).optional().describe("Competency tags, e.g. ['leadership','mentoring']"),
        date: z.string().optional().describe("YYYY-MM-DD. Defaults to today; also selects the year file."),
        id: z.string().optional().describe("Explicit dedup slug. Defaults to a slug of the title."),
      },
    },
    async ({ subject, title, theme, summary, references, goal, tags, date, id }) => {
      const year = appraisal.yearOf(date);
      const { path: filePath, md } = readAppraisalMd(subject, year);

      if (goal && !appraisal.goalSlugs(md).includes(goal)) {
        const valid = appraisal.goalSlugs(md);
        return {
          content: [
            {
              type: "text",
              text: `Unknown goal "${goal}" for ${subject ?? "self"} ${year}. Valid goals: ${valid.length ? valid.join(", ") : "(none — create one with appraisal_set_goal)"}.`,
            },
          ],
          isError: true,
        };
      }

      const result = appraisal.upsertEntry(md, { title, theme, summary, references, goal, tags, date, id });
      writeAppraisalMd(filePath, result.md);

      const warn = appraisal.summaryWarning(summary);
      const action = result.created ? "Recorded" : "Updated";
      return {
        content: [
          {
            type: "text",
            text: `${action} appraisal entry "${result.slug}" under ${appraisal.THEME_LABELS[theme]} in ${filePath}.${warn ? ` ⚠ ${warn}` : ""}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "appraisal_set_goal",
    {
      description:
        "Create or revise a review goal/objective for a subject. Goals are mutable — call again with the same title/id to change status or append a dated revision (history preserved). Status: active | revised | dropped | achieved.",
      inputSchema: {
        subject: z.string().optional().describe("'self' (default) or a person name/slug"),
        title: z.string().describe("Goal title, e.g. 'Ship the new matching pipeline to GA'"),
        detail: z.string().optional().describe("What success looks like; 1-2 sentences"),
        status: z.enum(appraisal.GOAL_STATUSES).optional().describe("Default 'active'"),
        revision: z.string().optional().describe("What changed; appended as a dated 'Revised:' line"),
        year: z.string().optional().describe("YYYY. Defaults to current year."),
        id: z.string().optional().describe("Explicit goal slug. Defaults to a slug of the title."),
      },
    },
    async ({ subject, title, detail, status, revision, year, id }) => {
      const yr = appraisal.yearOf(year);
      const { path: filePath, md } = readAppraisalMd(subject, yr);
      const result = appraisal.upsertGoal(md, { title, detail, status, revision, id });
      writeAppraisalMd(filePath, result.md);
      return {
        content: [
          {
            type: "text",
            text: `${result.created ? "Created" : "Updated"} goal "${result.slug}" in ${filePath}. Link moments to it via appraisal_record(goal: "${result.slug}").`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "appraisal_list_goals",
    {
      description: "List review goals for a subject/year with status and revision history.",
      inputSchema: {
        subject: z.string().optional(),
        year: z.string().optional().describe("YYYY. Defaults to current year."),
        status: z.enum(appraisal.GOAL_STATUSES).optional().describe("Filter by status"),
      },
    },
    async ({ subject, year, status }) => {
      const yr = appraisal.yearOf(year);
      const { md, exists } = readAppraisalMd(subject, yr);
      let goals = appraisal.parseGoals(md);
      if (status) goals = goals.filter((g) => g.status === status);
      if (!exists || goals.length === 0) {
        return {
          content: [{ type: "text", text: `No goals for ${subject ?? "self"} ${yr}${status ? ` (status=${status})` : ""}.` }],
        };
      }
      const lines = goals.map((g) => {
        const revs = g.revisions.length ? `\n    ${g.revisions.join("\n    ")}` : "";
        return `- [${g.status}] ${g.title} (${g.slug}) · set ${g.set} · updated ${g.updated}${g.detail ? `\n    ${g.detail}` : ""}${revs}`;
      });
      return { content: [{ type: "text", text: `Goals for ${subject ?? "self"} ${yr}:\n${lines.join("\n")}` }] };
    },
  );

  server.registerTool(
    "appraisal_read",
    {
      description:
        "Read a subject's appraisal note (goals + entries) as markdown. Optionally filter entries by theme, tag, or linked goal.",
      inputSchema: {
        subject: z.string().optional().describe("'self' (default) or a person name/slug"),
        year: z.string().optional().describe("YYYY. Defaults to current year."),
        theme: z.enum(appraisal.THEMES).optional(),
        tag: z.string().optional().describe("Filter to entries carrying this tag"),
        goal: z.string().optional().describe("Filter to entries linked to this goal slug"),
      },
    },
    async ({ subject, year, theme, tag, goal }) => {
      const yr = appraisal.yearOf(year);
      const { md, exists } = readAppraisalMd(subject, yr);
      if (!exists) {
        return { content: [{ type: "text", text: `No appraisal note for ${subject ?? "self"} ${yr} yet. Skeleton:\n\n${md}` }] };
      }
      if (!theme && !tag && !goal) {
        return { content: [{ type: "text", text: md }] };
      }
      const wantTag = tag ? (tag.startsWith("#") ? tag : `#${tag}`) : undefined;
      const entries = appraisal.parseEntries(md).filter(
        (e) =>
          (!theme || e.theme === theme) &&
          (!wantTag || e.tags.includes(wantTag)) &&
          (!goal || e.goal === goal),
      );
      if (entries.length === 0) {
        return { content: [{ type: "text", text: `No matching entries for ${subject ?? "self"} ${yr}.` }] };
      }
      const lines = entries.map(
        (e) =>
          `### ${e.title} [${appraisal.THEME_LABELS[e.theme]}]\n${e.date} — ${e.body}${e.goal ? `\nGoal: ${e.goal}` : ""}${e.tags.length ? `\nTags: ${e.tags.join(" ")}` : ""}`,
      );
      return { content: [{ type: "text", text: lines.join("\n\n") }] };
    },
  );

  server.registerTool(
    "appraisal_list",
    { description: "List all appraisal year files (self and people) with entry/goal counts." },
    async () => {
      const files = storage.getAllNoteFiles().filter((f) => f.startsWith("appraisal/"));
      if (files.length === 0) {
        return { content: [{ type: "text", text: "No appraisal notes yet." }] };
      }
      const lines = files.map((f) => {
        const rel = f.replace(/\.json$/, "");
        const note = storage.read(rel);
        const blocks = (note?.content as unknown[]) ?? [];
        const md = blocksToText(Array.isArray(blocks) ? blocks : [blocks]);
        return `- ${rel} — ${appraisal.parseEntries(md).length} entries, ${appraisal.goalSlugs(md).length} goals`;
      });
      return { content: [{ type: "text", text: `Appraisal notes:\n${lines.join("\n")}` }] };
    },
  );

  server.registerTool(
    "appraisal_people",
    { description: "List the people you have appraisal notes for (slugs + years)." },
    async () => {
      const files = storage.getAllNoteFiles().filter((f) => f.startsWith("appraisal/people/"));
      if (files.length === 0) {
        return {
          content: [
            { type: "text", text: "No people appraisal notes yet. Create one with appraisal_record(subject: 'Their Name', ...)." },
          ],
        };
      }
      const byPerson: Record<string, string[]> = {};
      for (const f of files) {
        const m = f.match(/^appraisal\/people\/([^/]+)\/(\d{4})\.json$/);
        if (!m) continue;
        (byPerson[m[1]] ??= []).push(m[2]);
      }
      const lines = Object.entries(byPerson).map(([slug, years]) => `- ${slug}: ${years.sort().join(", ")}`);
      return { content: [{ type: "text", text: `People with appraisal notes:\n${lines.join("\n")}` }] };
    },
  );

  server.registerTool(
    "appraisal_summarize",
    {
      description:
        "Assemble a review-ready digest of a subject's year: goals with status, then entries grouped by theme with references intact. Use at review time to draft the self-appraisal (subject 'self') or your write-up of someone you appraise. Returns structured source — does not invent un-referenced claims.",
      inputSchema: {
        subject: z.string().optional().describe("'self' (default) or a person name/slug"),
        year: z.string().optional().describe("YYYY. Defaults to current year."),
        theme: z.enum(appraisal.THEMES).optional().describe("Limit to one theme"),
      },
    },
    async ({ subject, year, theme }) => {
      const yr = appraisal.yearOf(year);
      const { md, exists } = readAppraisalMd(subject, yr);
      if (!exists) {
        return { content: [{ type: "text", text: `No appraisal note for ${subject ?? "self"} ${yr} to summarize.` }] };
      }
      const goals = appraisal.parseGoals(md);
      const entries = appraisal.parseEntries(md).filter((e) => !theme || e.theme === theme);
      const out: string[] = [`# Appraisal digest — ${subject ?? "self"} ${yr}`];

      if (goals.length) {
        out.push("\n## Goals");
        for (const g of goals)
          out.push(
            `- [${g.status}] ${g.title}${g.revisions.length ? ` (${g.revisions.length} revision${g.revisions.length > 1 ? "s" : ""})` : ""}`,
          );
      }

      for (const t of appraisal.THEMES) {
        if (theme && t !== theme) continue;
        const themed = entries.filter((e) => e.theme === t);
        if (!themed.length) continue;
        out.push(`\n## ${appraisal.THEME_LABELS[t]}`);
        for (const e of themed) {
          out.push(`- ${e.title} — ${e.date}: ${e.body}${e.goal ? ` [goal: ${e.goal}]` : ""}`);
        }
      }
      return { content: [{ type: "text", text: out.join("\n") }] };
    },
  );

  server.registerTool(
    "appraisal_delete",
    {
      description:
        "Delete a single appraisal entry by subject + year + slug. Goals are not deletable (mark them 'dropped' via appraisal_set_goal to keep history).",
      inputSchema: {
        slug: z.string().describe("Entry slug (the <!-- id: ... --> value)"),
        subject: z.string().optional().describe("'self' (default) or a person name/slug"),
        year: z.string().optional().describe("YYYY. Defaults to current year."),
      },
    },
    async ({ slug, subject, year }) => {
      const yr = appraisal.yearOf(year);
      const { path: filePath, md, exists } = readAppraisalMd(subject, yr);
      if (!exists) {
        return { content: [{ type: "text", text: `No appraisal note for ${subject ?? "self"} ${yr}.` }] };
      }
      const result = appraisal.deleteEntry(md, slug);
      if (!result.deleted) {
        return { content: [{ type: "text", text: `Entry "${slug}" not found in ${filePath}.` }] };
      }
      writeAppraisalMd(filePath, result.md);
      return { content: [{ type: "text", text: `Deleted entry "${slug}" from ${filePath}.` }] };
    },
  );
}
