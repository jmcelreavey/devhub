export const TASK_QA_SCENARIO_LANGUAGE = "devhub-qa";
export const TASK_QA_GOAL_LIMIT = 5;

export interface TaskQaGoal {
  description: string;
  assertion: "text" | "visible";
  selector: string;
  expected?: string;
}

export interface TaskQaScenario {
  goals: TaskQaGoal[];
}

export function taskQaSources(markdown: string): { references: string[]; declarations: string[]; unclosed: boolean; unclosedFence: boolean; unclosedComment: boolean; verificationSections: number; baselineRequired: boolean } {
  const references: string[] = [];
  const declarations: string[] = [];
  let inVerification = false;
  let verificationSections = 0;
  let baselineRequired = false;
  let inComment = false;
  let fence: string | null = null;
  let fenceMaxIndent = 3;
  let declaration: string[] | null = null;
  for (const rawLine of markdown.replace(/\r\n/g, "\n").split("\n")) {
    let line = rawLine;
    if (!fence) {
      let visible = "";
      let remaining = line;
      while (remaining) {
        if (inComment) {
          const end = remaining.indexOf("-->");
          if (end < 0) break;
          inComment = false;
          remaining = remaining.slice(end + 3);
          continue;
        }
        const start = remaining.indexOf("<!--");
        if (start < 0) { visible += remaining; break; }
        visible += remaining.slice(0, start);
        remaining = remaining.slice(start + 4);
        inComment = true;
      }
      line = visible;
    }
    const marker = line.match(/^([ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*)(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (!fence) {
        fence = marker[2];
        const indent = marker[1].replace(/\t/g, "    ").length;
        fenceMaxIndent = /[^ \t]/.test(marker[1]) || indent > 3 ? indent + 3 : 3;
        if (inVerification && /^ {0,3}$/.test(marker[1]) && marker[3].trim() === TASK_QA_SCENARIO_LANGUAGE) declaration = [];
      } else if (/^[ \t]*$/.test(marker[1]) && marker[1].replace(/\t/g, "    ").length <= fenceMaxIndent && marker[2][0] === fence[0] && marker[2].length >= fence.length && !marker[3].trim()) {
        if (declaration) declarations.push(declaration.join("\n"));
        declaration = null;
        fence = null;
      } else if (declaration) declaration.push(rawLine);
      continue;
    }
    if (fence) {
      if (declaration) declaration.push(rawLine);
      continue;
    }
    if (/^ {0,3}#{1,2}(?:\s|$)/.test(line)) {
      inVerification = /^ {0,3}##\s+Verification\b/i.test(line);
      if (inVerification) verificationSections += 1;
      continue;
    }
    if (!inVerification) continue;
    if (/^ {0,3}(?:-\s+)?Baseline capture:\s*required\s*$/i.test(line)) baselineRequired = true;
    const reference = line.match(/^ {0,3}(?:[-*+]\s+)?QA scenario:\s*(.*?)\s*$/i);
    if (reference) references.push(reference[1].replace(/^`|`$/g, "").trim());
  }
  return { references, declarations, unclosed: declaration !== null, unclosedFence: fence !== null, unclosedComment: inComment, verificationSections, baselineRequired };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number): string | null {
  // eslint-disable-next-line no-control-regex -- Reject control characters in QA inputs.
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const result = value.trim();
  return result && result.length <= maximum ? result : null;
}

export function parseTaskQaScenario(input: unknown): { ok: true; scenario: TaskQaScenario } | { ok: false; error: string } {
  if (!record(input) || Object.keys(input).some((key) => key !== "goals") || !Array.isArray(input.goals) || input.goals.length < 1 || input.goals.length > TASK_QA_GOAL_LIMIT) {
    return { ok: false, error: `QA scenario needs 1–${TASK_QA_GOAL_LIMIT} goals and cannot specify a URL, actions or other fields.` };
  }
  const goals: TaskQaGoal[] = [];
  for (const value of input.goals) {
    if (!record(value) || Object.keys(value).some((key) => !["description", "assertion", "selector", "expected"].includes(key))) {
      return { ok: false, error: "Each QA goal accepts only description, assertion, selector and expected." };
    }
    const description = boundedString(value.description, 200);
    const selector = boundedString(value.selector, 300);
    if (!description || !selector || /^(?:body|html|:root|\*)$/i.test(selector)) {
      return { ok: false, error: "Each QA goal needs a description and a specific element selector, not the page root." };
    }
    if (value.assertion === "text") {
      const expected = boundedString(value.expected, 300);
      if (!expected) return { ok: false, error: "A text assertion needs non-empty expected text." };
      goals.push({ description, assertion: "text", selector, expected });
    } else if (value.assertion === "visible" && value.expected === undefined) {
      goals.push({ description, assertion: "visible", selector });
    } else {
      return { ok: false, error: "Use a text assertion with expected text, or a visible assertion without expected text." };
    }
  }
  return { ok: true, scenario: { goals } };
}
