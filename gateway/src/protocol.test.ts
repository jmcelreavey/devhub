import { expect, it } from "vitest";
import { validOperation } from "../../shared/slack-gateway/protocol.ts";

it.each([
  { kind: "listMembers" },
  { kind: "askTeammate", askId: "ask-one", helperUserId: "W123", text: "Question" },
  { kind: "askTeammate", askId: "ask-one", helperUserId: "U123", channel: "G123", text: "Question", blocks: [] },
  { kind: "handoff", handoffId: "handoff-one", toUserId: "U123", text: "Note", blocks: [] },
  { kind: "handoffResolve", handoffId: "handoff-one", outcome: "accepted" },
  { kind: "handoffResolve", handoffId: "handoff-one", outcome: "failed" },
  { kind: "handoffStatus", handoffIds: Array.from({ length: 50 }, (_, index) => `handoff-${index}`) },
])("accepts an additive team operation: %j", (operation) => { expect(validOperation(operation)).toBe(true); });

it.each([
  { kind: "listMembers", userId: "U123" },
  { kind: "askTeammate", askId: "", helperUserId: "U123", text: "Question" },
  { kind: "askTeammate", askId: "ask-one", helperUserId: "D123", text: "Question" },
  { kind: "askTeammate", askId: "ask-one", helperUserId: "U123", channel: "D123", text: "Question" },
  { kind: "askTeammate", askId: "ask-one", helperUserId: "U123", userId: "U999", text: "Question" },
  { kind: "askTeammate", askId: "ask-one", helperUserId: "U123", text: "x".repeat(40001) },
  { kind: "handoff", handoffId: "handoff-one", toUserId: "U123", text: "Note" },
  { kind: "handoff", handoffId: "handoff-one", toUserId: "U123", text: "Note", blocks: Array(51).fill({}) },
  { kind: "handoffResolve", handoffId: "handoff-one", outcome: "declined" },
  { kind: "handoffResolve", handoffId: "handoff-one", outcome: ["accepted"] },
  { kind: "handoffStatus", handoffIds: ["one", "one"] },
  { kind: "handoffStatus", handoffIds: [null] },
  { kind: "handoffStatus", handoffIds: Array.from({ length: 51 }, (_, index) => `handoff-${index}`) },
])("rejects malformed team operations: %j", (operation) => { expect(validOperation(operation)).toBe(false); });
