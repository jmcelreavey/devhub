/** Shapes shared by the /voice page and its API routes. Pure types: safe to import client-side. */

export type VoiceRegister = "slack" | "email" | "ticket" | "pr" | "commit" | "chat" | "feedback";

export interface VoiceScenario {
  id: string;
  register: VoiceRegister;
  /** The circumstance, as it would land on you. */
  situation: string;
  /** What to write back. */
  task: string;
}

export interface VoiceAnswer {
  scenarioId: string;
  answer: string;
  answeredAt: string;
  /** Set once the answer has been folded into learned-voice.md. */
  trainedAt?: string;
}

export interface VoiceState {
  scenarios: VoiceScenario[];
  answers: VoiceAnswer[];
  skill: {
    found: boolean;
    readOnly: boolean;
    /** mtime of learned-voice.md, or null before the first training round. */
    learnedModified: number | null;
  };
  aiConfigured: boolean;
}

/** Identifies one exact version of an answer: editing it changes `answeredAt`. */
export type VoiceAnswerRef = Pick<VoiceAnswer, "scenarioId" | "answeredAt">;

export interface VoiceProposal {
  /** Full replacement for learned-voice.md. */
  content: string;
  /** The answers this draft was built from; marked trained when it is applied. */
  answers: VoiceAnswerRef[];
  /** What learned-voice.md holds today, for side-by-side review. */
  current: string | null;
}

export interface VoiceApplyResult {
  ok: true;
  /** Whether the skill was copied out to the agent tools' skill folders. */
  synced: boolean;
  syncError?: string;
}

export const MAX_ANSWER_CHARS = 4000;
