export type CapabilityRequest = { kind: "overview" } | { kind: "tools"; group?: string };

export function capabilityRequest(text: string): CapabilityRequest | undefined {
  const normal = text.toLowerCase().trim().replace(/[?!.,:;]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normal || /^(?:help|hello|hi|commands|what (?:else )?can you do|what can devhub do|capabilities)$/.test(normal)) return { kind: "overview" };
  if (/^(?:tools|all tools|list (?:all )?tools|show tools|what tools)$/.test(normal)) return { kind: "tools" };
  // "tools tasks", "what task tools", "tools for tasks": all name a group.
  const group = /^tools (?:for |about |in )?(.+)$/.exec(normal)?.[1]
    ?? /^(?:(?:what|which|show|list|show me|list the|show the) )?(?:(?:the|all) )?(.+?) tools$/.exec(normal)?.[1];
  if (group && !/^(?:are|is|were|was|do|does|have|has|broken|refresh|reload|update|run|use|invoke|my|the|your)\b/.test(group) && !/\b[a-z][a-z0-9_]*-[1-9][0-9]*\b/.test(group)) return { kind: "tools", group };
  return undefined;
}

export const CAPABILITY_ACTIONS = Array.from({ length: 25 }, (_, index) => `devhub_tool_capabilities_${index}`);
