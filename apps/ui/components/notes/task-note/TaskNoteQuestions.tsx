"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import type { QuestionItem, TaskNoteOp } from "@shared/task-note/sections.ts";
import { cx } from "./TaskNotePills";
import styles from "./task-note.module.css";

/** Reply with a question instead of an answer; resolves true when the agent was sent it. */
export type AskBack = (text: string) => Promise<boolean>;

export type TaskNoteOperation = (op: TaskNoteOp) => void | boolean | Promise<void | boolean>;

function QuestionCard({ question, onOp, onAskBack, autoFocus, initialAnswer = "" }: { question: QuestionItem; onOp: TaskNoteOperation; onAskBack?: AskBack; autoFocus: boolean; initialAnswer?: string }) {
  const [answer, setAnswer] = useState(initialAnswer);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [asking, setAsking] = useState(false);
  const [ask, setAsk] = useState("");
  const inFlight = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (autoFocus && !question.resolved) inputRef.current?.focus(); }, [autoFocus, question.resolved]);

  const apply = async (op: TaskNoteOp) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailure("");
    try {
      const saved = await onOp(op);
      if (saved === false) {
        setFailure("Couldn't save the answer. Your text is still here; try again.");
        return;
      }
      setAnswer("");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Couldn't save the answer. Try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (question.resolved) return (
    <div className={cx(styles.item, styles.questionDone)} data-question="resolved">
      <span className={styles.itemRow}>
        <Check size={13} aria-hidden />
        <span>{question.text}{question.answer ? <> <span className={styles.detail}>Answered:</span> {question.answer}</> : null}</span>
        <button type="button" className={styles.linkButton} disabled={busy} onClick={() => void apply({ op: "resolve_question", id: question.id, reopen: true })}>Reopen</button>
      </span>
      {failure ? <p role="alert">{failure}</p> : null}
    </div>
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (answer.trim()) void apply({ op: "resolve_question", id: question.id, answer: answer.trim() });
  };
  return (
    <form className={cx(styles.item, styles.question)} data-question="open" onSubmit={submit} aria-busy={busy || undefined}>
      <div>{question.text}</div>
      {question.options?.length ? <div className={styles.options} role="group" aria-label="Suggested answers, pick one then press Answer">
        {question.options.map((option) => <button key={option} type="button" className={styles.option} aria-pressed={answer === option} disabled={busy} onClick={() => { setAnswer(option); inputRef.current?.focus(); }}>{option}</button>)}
      </div> : null}
      <div className={styles.answerRow}>
        <input ref={inputRef} className="input" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder={question.options?.length ? "Or write your own answer" : "Your answer"} aria-label={`Answer: ${question.text}`} readOnly={busy} />
        <button type="submit" className={styles.button} disabled={busy || !answer.trim()}>{busy ? "Saving…" : "Answer"}</button>
        {/* For a question already settled in the note or in chat: close it without writing an answer. */}
        <button type="button" className={styles.linkButton} disabled={busy} onClick={() => void apply({ op: "resolve_question", id: question.id })}>Mark answered</button>
        {onAskBack ? <button type="button" className={styles.linkButton} disabled={busy} aria-expanded={asking} onClick={() => setAsking((open) => !open)}>Ask back</button> : null}
      </div>
      {asking && onAskBack ? <div className={styles.answerRow}>
        <input className="input" value={ask} onChange={(event) => setAsk(event.target.value)} placeholder="Ask the agent something about this" aria-label={`Ask back about: ${question.text}`} readOnly={busy} />
        <button type="button" className={styles.button} disabled={busy || !ask.trim()} onClick={() => {
          setBusy(true); setFailure("");
          void onAskBack(ask.trim()).then((sent) => { if (sent) { setAsk(""); setAsking(false); } else setFailure("Couldn't send that. Try again."); }).catch((error: unknown) => setFailure(error instanceof Error ? error.message : "Couldn't send that.")).finally(() => setBusy(false));
        }}>{busy ? "Sending…" : "Send"}</button>
      </div> : null}
      {failure ? <p role="alert">{failure}</p> : null}
    </form>
  );
}

export function TaskNoteQuestions({ questions, onOp, onAskBack, autoFocus = false, includeResolved = true, initialAnswers = {} }: { questions: QuestionItem[]; onOp: TaskNoteOperation; onAskBack?: AskBack; autoFocus?: boolean; includeResolved?: boolean; initialAnswers?: Record<string, string> }) {
  const open = questions.filter((question) => !question.resolved);
  const shown = includeResolved ? [...open, ...questions.filter((question) => question.resolved)] : open;
  return <div className={styles.stack}>{shown.map((question) => <QuestionCard key={question.id || question.text} question={question} onOp={onOp} onAskBack={onAskBack} autoFocus={autoFocus && question === open[0]} initialAnswer={initialAnswers[question.id]} />)}</div>;
}
