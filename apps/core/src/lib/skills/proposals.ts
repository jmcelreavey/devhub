import { skillsProposeUpdateBodyInput } from "../../../../../packages/shared/actions/workspace";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { getResourceRoot } from "../desktop/runtime-paths";
import { profileStateDir } from "../../../../../packages/shared/storage/profile-state";
import { resolveSkillForRead } from "./catalog";
import { devhubSharedSkillsDir, READ_ONLY_UPSTREAM_SKILL_ERROR } from "./shared";
import { readAgentRun } from "../agent-runs/store";
import { withPluginMutationLock } from "../plugins/lock";
import { writeAtomicNow } from "../atomic-write";

export const proposalInput = skillsProposeUpdateBodyInput;
const proposalSchema = proposalInput.omit({ content: true, runId: true }).extend({
  id: z.string().uuid(), createdAt: z.string(), before: z.string(), after: z.string(),
  file: z.string(), status: z.enum(["pending", "accepted", "rejected"]), decidedAt: z.string().optional(),
  run: z.object({ id: z.string(), title: z.string(), finishedAt: z.number() }),
});
export type SkillProposal = z.infer<typeof proposalSchema>;
export class SkillProposalError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export const skillRevision = (content: string) => createHash("sha256").update(content).digest("hex");
const store = () => path.join(profileStateDir(), "skill-proposals");
function editableSkill(name: string) {
  const skill = resolveSkillForRead(getResourceRoot(), name);
  if (!skill) throw new SkillProposalError("Skill no longer exists.", 404);
  if (skill.readOnly || skill.source !== "devhub") throw new SkillProposalError(READ_ONLY_UPSTREAM_SKILL_ERROR, 403);
  const file = fs.realpathSync(skill.file), shared = fs.realpathSync(devhubSharedSkillsDir(getResourceRoot()));
  if (path.relative(shared, file).startsWith("..") || path.isAbsolute(path.relative(shared, file)) || fs.lstatSync(skill.file).isSymbolicLink()) throw new SkillProposalError("Skill source must be inside skills/shared.", 403);
  if (fs.statSync(file).size > 100_000) throw new SkillProposalError("This skill is too large for a proposal.", 400);
  return { file, content: fs.readFileSync(file, "utf8") };
}
function proposalFile(id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new SkillProposalError("Invalid proposal.", 400);
  return path.join(store(), id + ".json");
}
export function readSkillProposal(id: string): SkillProposal {
  try { return proposalSchema.parse(JSON.parse(fs.readFileSync(proposalFile(id), "utf8"))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new SkillProposalError("Proposal no longer exists.", 404);
    throw error;
  }
}
export interface SkillProposalSummary extends Omit<SkillProposal, "before" | "after" | "file" | "evidence"> { stale: boolean; unavailable?: string }
export function listSkillProposals(): SkillProposalSummary[] {
  if (!fs.existsSync(store())) return [];
  return fs.readdirSync(store()).filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).sort().map(name => {
    const saved = readSkillProposal(name.slice(0, -5));
    const { file } = saved;
    const proposal = { id: saved.id, skill: saved.skill, baseRevision: saved.baseRevision,
      reason: saved.reason, createdAt: saved.createdAt, status: saved.status,
      decidedAt: saved.decidedAt, run: saved.run };
    try {
      const current = editableSkill(proposal.skill);
      return { ...proposal, stale: current.file !== file || skillRevision(current.content) !== proposal.baseRevision };
    } catch (error) { return { ...proposal, stale: true, unavailable: error instanceof Error ? error.message : "Skill unavailable." }; }
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
}
export async function createSkillProposal(raw: unknown): Promise<SkillProposal> {
  const input = proposalInput.parse(raw);
  return withPluginMutationLock(store(), async () => {
    const skill = editableSkill(input.skill);
    if (skillRevision(skill.content) !== input.baseRevision) throw new SkillProposalError("The skill changed. Read it again before proposing an update.");
    if (skill.content.trim() === input.content.trim()) throw new SkillProposalError("The proposal does not change the skill.", 400);
    const run = readAgentRun(input.runId);
    if (!run || run.status.state !== "succeeded" || !run.status.finishedAt) throw new SkillProposalError("Cite a completed, successful DevHub run.", 400);
    const duplicate = listSkillProposals().find(item => item.status === "pending" && item.skill === input.skill && item.baseRevision === input.baseRevision && item.run.id === input.runId && readSkillProposal(item.id).after === input.content + "\n");
    if (duplicate) return readSkillProposal(duplicate.id);
    const proposal: SkillProposal = {
      id: randomUUID(), skill: input.skill, baseRevision: input.baseRevision, reason: input.reason, evidence: input.evidence,
      createdAt: new Date().toISOString(), before: skill.content, after: input.content + "\n", file: skill.file, status: "pending",
      run: { id: run.spec.id, title: run.spec.title, finishedAt: run.status.finishedAt },
    };
    writeAtomicNow(proposalFile(proposal.id), JSON.stringify(proposal));
    return proposal;
  });
}
export async function decideSkillProposal(id: string, decision: "accept" | "reject", baseRevision: string) {
  return withPluginMutationLock(store(), async () => {
    const proposal = readSkillProposal(id);
    if (proposal.baseRevision !== baseRevision) throw new SkillProposalError("The reviewed revision does not match this proposal.");
    const targetStatus = decision === "accept" ? "accepted" : "rejected";
    if (proposal.status !== "pending") {
      if (proposal.status === targetStatus) return proposal;
      throw new SkillProposalError("This proposal has already been reviewed.");
    }
    if (decision === "accept") {
      const current = editableSkill(proposal.skill);
      if (current.file !== proposal.file) throw new SkillProposalError("Skill ownership changed. Propose a new update in its source repository.");
      const currentRevision = skillRevision(current.content);
      // A retry after a crash between these two atomic writes only completes its receipt.
      if (currentRevision !== skillRevision(proposal.after)) {
        if (currentRevision !== proposal.baseRevision) throw new SkillProposalError("The skill changed after this proposal. Nothing was overwritten; propose a fresh update.");
        writeAtomicNow(current.file, proposal.after);
      }
    }
    const result: SkillProposal = { ...proposal, status: targetStatus, decidedAt: new Date().toISOString() };
    writeAtomicNow(proposalFile(id), JSON.stringify(result));
    return result;
  });
}
