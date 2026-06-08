"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { BookOpen, ChevronRight, Clock, FileText, Plus } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { getVaultClient } from "@/lib/vault/vault-client";
import type { VaultId } from "@/lib/vault/vault-client";
import type {
  VaultIndexFile,
  VaultIndexFolder,
  VaultIndexSummary,
} from "@/lib/vault/vault-index-summary";

function formatModified(ms?: number): string | null {
  if (ms == null) return null;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function IndexFileRow({ file }: { file: VaultIndexFile }) {
  const modified = formatModified(file.modified);
  return (
    <Link
      href={file.href}
      className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm no-underline transition-colors hover:bg-[var(--bg-elevated)]"
      style={{ color: "var(--text)" }}
    >
      <FileText
        size={14}
        className="shrink-0"
        style={{ color: "var(--text-subtle)" }}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">{file.label}</span>
      {modified ? (
        <span className="shrink-0 text-xs" style={{ color: "var(--text-subtle)" }}>
          {modified}
        </span>
      ) : null}
      <ChevronRight
        size={12}
        className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        style={{ color: "var(--text-subtle)" }}
        aria-hidden
      />
    </Link>
  );
}

function FolderSection({
  folder,
  depth = 0,
}: {
  folder: VaultIndexFolder;
  depth?: number;
}) {
  const hasContent =
    folder.files.length > 0 || folder.children.some((c) => c.files.length > 0 || c.children.length > 0);
  if (!hasContent) return null;

  return (
    <section className={depth > 0 ? "mt-3" : "mt-4"}>
      <h3
        className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide"
        style={{
          color: "var(--text-subtle)",
          paddingLeft: `${8 + depth * 12}px`,
        }}
      >
        {folder.name}
      </h3>
      {folder.files.length > 0 ? (
        <div className="min-w-0">
          {folder.files.map((file) => (
            <div key={file.slug} style={{ paddingLeft: `${depth * 12}px` }}>
              <IndexFileRow file={file} />
            </div>
          ))}
        </div>
      ) : null}
      {folder.children.map((child) => (
        <FolderSection key={child.path} folder={child} depth={depth + 1} />
      ))}
    </section>
  );
}

export function VaultIndexPage({
  vaultId,
  summary,
  footerHint,
}: {
  vaultId: VaultId;
  summary: VaultIndexSummary;
  /** Optional extra line under the hero (e.g. notes checklists). */
  footerHint?: ReactNode;
}) {
  const vault = getVaultClient(vaultId);
  const title = vaultId === "docs" ? "Docs" : "Notes";
  const Icon = vaultId === "docs" ? BookOpen : FileText;

  const handleNew = () => {
    window.dispatchEvent(new CustomEvent(vault.newItemEvent));
  };

  return (
    <div className="page-wrapper max-w-3xl">
      <header className="page-header mb-6" style={{ alignItems: "flex-start" }}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Icon size={18} style={{ color: "var(--accent)" }} aria-hidden />
            <h1 className="text-lg font-semibold m-0" style={{ color: "var(--text)" }}>
              {title}
            </h1>
          </div>
          <p className="text-sm m-0" style={{ color: "var(--text-muted)" }}>
            {summary.totalFiles === 0
              ? `No ${vault.itemLabelPlural} yet. Create one to get started.`
              : `${summary.totalFiles} ${summary.totalFiles === 1 ? vault.itemLabel : vault.itemLabelPlural} in this library`}
          </p>
          {footerHint ? (
            <p className="text-xs mt-2 m-0" style={{ color: "var(--text-subtle)" }}>
              {footerHint}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={handleNew}
          className="btn btn-primary text-xs shrink-0 flex items-center gap-1"
        >
          <Plus size={14} aria-hidden />
          New {vault.itemLabel}
        </button>
      </header>

      {summary.totalFiles === 0 ? (
        <EmptyState
          icon={<Icon size={32} />}
          title={`No ${vault.itemLabelPlural} yet`}
          subtitle={
            <button
              type="button"
              className="btn btn-ghost text-xs mt-2"
              onClick={handleNew}
            >
              Create your first {vault.itemLabel}
            </button>
          }
        />
      ) : (
        <div className="space-y-6">
          {summary.recent.length > 0 ? (
            <section className="card card-body">
              <div className="flex items-center gap-2 mb-3">
                <Clock size={14} style={{ color: "var(--text-subtle)" }} aria-hidden />
                <h2 className="text-sm font-semibold m-0" style={{ color: "var(--text)" }}>
                  Recent
                </h2>
              </div>
              <div className="min-w-0 -mx-2">
                {summary.recent.map((file) => (
                  <IndexFileRow key={file.slug} file={file} />
                ))}
              </div>
            </section>
          ) : null}

          <section className="card card-body">
            <h2 className="text-sm font-semibold m-0 mb-3" style={{ color: "var(--text)" }}>
              Contents
            </h2>
            {summary.rootFiles.length > 0 ? (
              <div className="mb-2">
                <h3
                  className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide"
                  style={{ color: "var(--text-subtle)" }}
                >
                  Top level
                </h3>
                {summary.rootFiles.map((file) => (
                  <IndexFileRow key={file.slug} file={file} />
                ))}
              </div>
            ) : null}
            {summary.folders.map((folder) => (
              <FolderSection key={folder.path} folder={folder} />
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
