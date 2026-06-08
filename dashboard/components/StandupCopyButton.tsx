"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, FileText, Settings2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useToast } from "@/lib/use-toast";
import { saveStandupAsDailyNote, type StandupTimeParams } from "@/lib/standup-daily-note";
import { HubSignalStrip } from "@/components/HubSignalStrip";
import { localCalendarDateISO, previousWorkingDayISO } from "@/lib/local-calendar-date";
import {
  STANDUP_STORAGE_KEYS,
  fetchStandup,
  readExcludedRepos,
  type StandupResponse,
  writeExcludedRepos,
} from "@/lib/standup-params";
import { StandupPreviewModal } from "@/components/StandupPreviewModal";

const DEFAULT_START_TIME = "00:00";
const DEFAULT_END_TIME = "23:59";

interface LocalRepo {
  name: string;
}

function storedTime(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return localStorage.getItem(key) || fallback;
}

const SMALL_BTN = { fontSize: 11, padding: "3px 8px" } as const;

function todayStr(): string {
  return localCalendarDateISO();
}

interface StandupCopyButtonProps {
  variant?: "strip" | "inline" | "compact";
}

export function StandupCopyButton({ variant = "strip" }: StandupCopyButtonProps) {
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewMarkdown, setPreviewMarkdown] = useState("");
  const [previewMeta, setPreviewMeta] = useState<StandupResponse["meta"]>(undefined);
  const [configOpen, setConfigOpen] = useState(false);
  const [reposExpanded, setReposExpanded] = useState(false);
  const [startDate, setStartDate] = useState(() => previousWorkingDayISO());
  const [startTime, setStartTime] = useState(() =>
    storedTime(STANDUP_STORAGE_KEYS.startTime, DEFAULT_START_TIME),
  );
  const [endDate, setEndDate] = useState(todayStr);
  const [endTime, setEndTime] = useState(() =>
    storedTime(STANDUP_STORAGE_KEYS.endTime, DEFAULT_END_TIME),
  );
  const [repos, setRepos] = useState<LocalRepo[]>([]);
  const [excludedRepos, setExcludedRepos] = useState<string[]>(() => readExcludedRepos());
  const toast = useToast();
  const router = useRouter();
  const closeConfigRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Persist time + excluded-repos selections.
  useEffect(() => {
    localStorage.setItem(STANDUP_STORAGE_KEYS.startTime, startTime);
  }, [startTime]);

  useEffect(() => {
    localStorage.setItem(STANDUP_STORAGE_KEYS.endTime, endTime);
  }, [endTime]);

  useEffect(() => {
    writeExcludedRepos(excludedRepos);
  }, [excludedRepos]);

  // Lazy-load repo list when the config panel opens for the first time.
  useEffect(() => {
    if (!configOpen || repos.length > 0) return;
    let cancelled = false;
    fetch("/api/repos")
      .then((r) => (r.ok ? r.json() : { repos: [] }))
      .catch(() => ({ repos: [] }))
      .then((data: { repos?: LocalRepo[] }) => {
        if (!cancelled) setRepos(data.repos ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [configOpen, repos.length]);

  const closeConfig = useCallback(() => {
    setConfigOpen(false);
    setReposExpanded(false);
  }, []);

  const toggleConfig = useCallback(() => {
    setConfigOpen((open) => !open);
  }, []);

  // Dialog focus management + Escape to close.
  useEffect(() => {
    if (!configOpen) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    closeConfigRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeConfig();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previousFocusRef.current?.focus?.();
    };
  }, [configOpen, closeConfig]);

  const params = useMemo<StandupTimeParams>(
    () => ({ startDate, startTime, endDate, endTime, excludeRepos: excludedRepos }),
    [startDate, startTime, endDate, endTime, excludedRepos],
  );

  function toggleRepo(name: string) {
    setExcludedRepos((curr) =>
      curr.includes(name) ? curr.filter((n) => n !== name) : [...curr, name],
    );
  }

  async function onSaveNote() {
    setBusy(true);
    try {
      const r = await saveStandupAsDailyNote(params);
      if (r.ok) {
        toast.success("Standup saved — opening note.");
        setPreviewOpen(false);
        router.push(`/notes/${r.notePath}`);
      } else {
        toast.error(r.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onPreview() {
    setPreviewOpen(true);
    closeConfig();
    setPreviewLoading(true);
    setPreviewMarkdown("");
    setPreviewMeta(undefined);
    const result = await fetchStandup(params);
    if (result.ok) {
      setPreviewMarkdown(result.data.markdown);
      setPreviewMeta(result.data.meta);
      if ((result.data.meta?.repoFailures.length ?? 0) > 0) {
        toast.error(`${result.data.meta?.repoFailures.length} repo(s) failed git scan.`);
      }
      if ((result.data.meta?.prScanFailedRepos?.length ?? 0) > 0) {
        toast.error(`PR scan failed for: ${result.data.meta?.prScanFailedRepos?.join(", ")} — some PRs may be missing.`);
      }
    } else {
      toast.error(result.message);
      setPreviewOpen(false);
    }
    setPreviewLoading(false);
  }

  const hintCopy =
    "Saves Git + Jira + PRs (authored + reviewed) and tasks due today under daily/, then opens the note.";

  const hiddenCount = excludedRepos.length;
  const configPanel =
    configOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="standup-config-title"
            className="standup-preview-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeConfig();
            }}
          >
            <div className="standup-config-dialog card">
              <div className="standup-preview-header">
                <h2 id="standup-config-title" className="standup-preview-title">
                  Standup time range
                </h2>
                <button
                  ref={closeConfigRef}
                  type="button"
                  className="btn btn-ghost inline-flex items-center justify-center"
                  style={{ padding: 6 }}
                  onClick={closeConfig}
                  aria-label="Close"
                >
                  <X size={14} aria-hidden />
                </button>
              </div>
              <div className="standup-config-body">
                <div className="standup-config-row">
                  <label>From</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="standup-config-date"
                  />
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="standup-config-time"
                  />
                </div>
                <div className="standup-config-row">
                  <label>To</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="standup-config-date"
                  />
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="standup-config-time"
                  />
                </div>
                <div className="standup-config-section">
                  <div className="standup-config-disclosure">
                    <span className="standup-config-section-title">
                      {hiddenCount === 0
                        ? "All repos included"
                        : `${hiddenCount} repo${hiddenCount === 1 ? "" : "s"} hidden`}
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={SMALL_BTN}
                      onClick={() => setReposExpanded((v) => !v)}
                      aria-expanded={reposExpanded}
                    >
                      {reposExpanded ? "Hide repos" : "Manage repos"}
                    </button>
                  </div>
                  {reposExpanded && (
                    <>
                      <div className="standup-config-bulk">
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={SMALL_BTN}
                          onClick={() => setExcludedRepos([])}
                          disabled={hiddenCount === 0}
                        >
                          Include all
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={SMALL_BTN}
                          onClick={() => setExcludedRepos(repos.map((r) => r.name))}
                          disabled={repos.length > 0 && hiddenCount === repos.length}
                        >
                          Exclude all
                        </button>
                      </div>
                      <div
                        className="standup-config-chips"
                        role="group"
                        aria-label="Filter repos"
                      >
                        {repos.length === 0 ? (
                          <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>
                            Loading repos…
                          </span>
                        ) : (
                          repos.map((r) => {
                            const isActive = !excludedRepos.includes(r.name);
                            return (
                              <button
                                key={r.name}
                                type="button"
                                className="standup-config-chip"
                                data-active={isActive}
                                onClick={() => toggleRepo(r.name)}
                                aria-pressed={isActive}
                              >
                                {r.name}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  const previewBtn = (
    <button
      type="button"
      className="btn btn-ghost inline-flex shrink-0 items-center justify-center"
      style={{ fontSize: 11, padding: "4px 6px", minHeight: 28 }}
      onClick={() => void onPreview()}
      aria-label="Preview standup"
    >
      <Eye size={12} aria-hidden />
    </button>
  );

  const settingsBtn = (
    <button
      type="button"
      className="btn btn-ghost inline-flex shrink-0 items-center justify-center"
      style={{ fontSize: 12, padding: "4px 6px", minHeight: 28 }}
      onClick={toggleConfig}
      aria-label="Standup time range"
      aria-haspopup="dialog"
      aria-expanded={configOpen}
    >
      <Settings2 size={12} aria-hidden />
    </button>
  );

  const previewModal = (
    <StandupPreviewModal
      open={previewOpen}
      loading={previewLoading}
      saving={busy}
      markdown={previewMarkdown}
      meta={previewMeta}
      onClose={() => setPreviewOpen(false)}
      onSaveNote={onSaveNote}
    />
  );

  if (variant === "compact") {
    return (
      <>
        <div className="inline-flex shrink-0 items-center gap-0.5 today-grid-drag-cancel">
          <button
            type="button"
            className="btn btn-ghost inline-flex shrink-0 items-center gap-1.5"
            style={{ fontSize: 12, padding: "4px 8px", minHeight: 28 }}
            onClick={() => void onSaveNote()}
            disabled={busy}
            aria-busy={busy}
          >
            <FileText size={13} aria-hidden />
            {busy ? "Building..." : "Save standup note"}
          </button>
          {previewBtn}
          {settingsBtn}
        </div>
        {configPanel}
        {previewModal}
      </>
    );
  }

  if (variant === "inline") {
    return (
      <>
        <div
          className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:items-start sm:gap-3"
          aria-label="Standup note"
        >
          <div className="inline-flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="btn btn-ghost inline-flex w-full min-h-11 shrink-0 items-center justify-start gap-1.5 sm:w-auto sm:min-h-0"
              style={{ fontSize: 12, padding: "8px 12px" }}
              onClick={() => void onSaveNote()}
              disabled={busy}
              aria-busy={busy}
            >
              <FileText size={14} aria-hidden />
              {busy ? "Building…" : "Save standup note"}
            </button>
            {previewBtn}
            {settingsBtn}
          </div>
          <span className="min-w-0 text-left leading-snug" style={{ color: "var(--text-muted)" }}>
            {hintCopy}
          </span>
        </div>
        {configPanel}
        {previewModal}
      </>
    );
  }

  return (
    <>
      <HubSignalStrip
        className="mb-3 flex flex-wrap items-start justify-start gap-2"
        aria-label="Standup note"
      >
        <div className="inline-flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="btn btn-ghost inline-flex shrink-0 items-center gap-1.5"
            style={{ fontSize: 12, padding: "6px 10px", minHeight: 36 }}
            onClick={() => void onSaveNote()}
            disabled={busy}
            aria-busy={busy}
          >
            <FileText size={13} aria-hidden />
            {busy ? "Building…" : "Save standup note"}
          </button>
          {previewBtn}
          {settingsBtn}
        </div>
        <span className="min-w-0 flex-1 text-left leading-snug" style={{ color: "var(--text-muted)" }}>
          {hintCopy}
        </span>
      </HubSignalStrip>
      {configPanel}
      {previewModal}
    </>
  );
}
