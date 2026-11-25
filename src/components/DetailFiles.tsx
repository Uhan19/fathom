import { useEffect, useRef, useState, type ReactNode } from "react";
import { relativeTime, exactTime } from "../activity";
import { api, errorText, type FileEntry, type FilePreview } from "../api";
import { formatBytes } from "../board";
import { isMac } from "../bosun";
import { states } from "../parts";
import type { Linking } from "../links";
import { ChevronLeft, FileIcon, FolderIcon, ImageIcon, OpenIcon, PageIcon, RevealIcon } from "./Icons";
import { Markdown, type PathAction } from "./Markdown";

const THUMBNAIL_MAX_BYTES = 4 * 1024 * 1024;
const REVEAL_LABEL = isMac(navigator.platform) ? "Show in Finder" : "Show in folder";

export function isPreviewable(entry: FileEntry): boolean {
  return entry.preview === "markdown" || entry.preview === "text" || entry.preview === "image";
}

export function openEntry(entry: FileEntry, onPreview: (path: string) => void) {
  if (isPreviewable(entry)) onPreview(entry.path);
  else void api.openFile(entry.path);
}

function entryMeta(entry: FileEntry, now: number, withFolder: boolean): string {
  const parts = withFolder ? [entry.folder || "Firstmate home"] : [];
  if (entry.kind === "folder") parts.push("folder");
  else if (entry.size !== null) parts.push(unbroken(formatBytes(entry.size)));
  if (entry.modifiedMs !== null) parts.push(unbroken(`changed ${relativeTime(entry.modifiedMs, now)}`));
  return parts.join(" · ");
}

const unbroken = (phrase: string) => phrase.replace(/ /g, "\u00a0");

function Glyph({ entry }: { entry: FileEntry }) {
  if (entry.kind === "folder") return <FolderIcon />;
  if (entry.preview === "image") return <ImageIcon />;
  if (entry.preview === "html") return <PageIcon />;
  return <FileIcon />;
}

function Thumb({ entry }: { entry: FileEntry }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const wanted = entry.preview === "image" && (entry.size ?? Infinity) <= THUMBNAIL_MAX_BYTES;
  useEffect(() => {
    const node = ref.current;
    if (!wanted || !node) return;
    let alive = true;
    const observer = new IntersectionObserver((seen) => {
      if (!seen.some((s) => s.isIntersecting)) return;
      observer.disconnect();
      api
        .filePreview(entry.path)
        .then((p) => alive && setSrc(p.dataUrl))
        .catch(() => undefined);
    });
    observer.observe(node);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [entry.path, wanted]);
  return (
    <span ref={ref} className={`file-glyph ${src ? "has-thumb" : ""}`} data-part="file-glyph" data-state={states({ thumb: src !== null })}>
      {src ? <img src={src} alt="" /> : <Glyph entry={entry} />}
    </span>
  );
}

function FileActions({ entry, wide }: { entry: FileEntry; wide?: boolean }) {
  const name = entry.name;
  return (
    <div className={`file-actions ${wide ? "wide" : ""}`} data-part="file-actions" data-kind={wide ? "wide" : undefined}>
      <button
        type="button"
        className={wide ? "btn btn-small" : "ico"}
        data-part={wide ? "button" : "icon-button"}
        data-kind={wide ? "small" : undefined}
        data-control="file-open-app"
        title={`Open ${name}`} aria-label={`Open ${name}`} onClick={() => void api.openFile(entry.path)}>
        <OpenIcon />
        {wide && <span>Open</span>}
      </button>
      <button
        type="button"
        className={wide ? "btn btn-small" : "ico"}
        data-part={wide ? "button" : "icon-button"}
        data-kind={wide ? "small" : undefined}
        data-control="file-reveal"
        title={`${REVEAL_LABEL}: ${name}`} aria-label={`${REVEAL_LABEL}: ${name}`} onClick={() => void api.revealFile(entry.path)}>
        <RevealIcon />
        {wide && <span>{REVEAL_LABEL}</span>}
      </button>
    </div>
  );
}

function FileRow({ entry, now, onPreview }: { entry: FileEntry; now: number; onPreview: (path: string) => void }) {
  const action = isPreviewable(entry) ? "Preview" : entry.kind === "folder" ? "Open folder" : "Open in its app";
  return (
    <li className="file-row" data-part="file-row" data-key={entry.path}>
      <button type="button" className="file-main" data-part="file-main" data-control="file-open" onClick={() => openEntry(entry, onPreview)} title={`${action}: ${entry.path}`}>
        <Thumb entry={entry} />
        <span className="file-text" data-part="file-text">
          <span className="file-name" data-part="file-name">
            {entry.name}
          </span>
          <span className="file-meta" data-part="file-meta" title={entry.modifiedMs !== null ? exactTime(entry.modifiedMs) : undefined}>
            {entryMeta(entry, now, !entry.inTaskFolder)}
          </span>
        </span>
      </button>
      <FileActions entry={entry} />
    </li>
  );
}

interface FilesTabProps {
  hasHome: boolean;
  files: FileEntry[] | null;
  error: string | null;
  taskFolder: string | null;
  cardId: string;
  selected: string | null;
  linking: Linking;
  onPreview: (path: string | null) => void;
}

export function FilesTab({ hasHome, files, error, taskFolder, cardId, selected, linking, onPreview }: FilesTabProps) {
  const now = Date.now();
  if (!hasHome) return <NeedsHome what="Files" />;
  if (error)
    return (
      <p className="tab-empty error-text" data-part="tab-empty" data-kind="error">
        Could not look for files: {error}
      </p>
    );
  if (!files) return <p className="tab-empty" data-part="tab-empty">Looking for files…</p>;
  const shown = selected ? files.find((f) => f.path === selected) : null;
  if (shown) return <PreviewPane entry={shown} files={files} now={now} linking={linking} onPreview={onPreview} />;
  if (files.length === 0)
    return (
      <p className="tab-empty" data-part="tab-empty">
        No files yet. Files in <code>data/{cardId}/</code> and files named in the note, hold reason or activity show up here.
      </p>
    );
  const inFolder = files.filter((f) => f.inTaskFolder);
  const elsewhere = files.filter((f) => !f.inTaskFolder);
  return (
    <>
      {inFolder.length > 0 && (
        <FileGroup kind="task-folder" title="Task folder" note={taskFolder}>
          {inFolder.map((f) => (
            <FileRow key={f.path} entry={f} now={now} onPreview={onPreview} />
          ))}
        </FileGroup>
      )}
      {elsewhere.length > 0 && (
        <FileGroup kind="mentioned" title="Mentioned in this card">
          {elsewhere.map((f) => (
            <FileRow key={f.path} entry={f} now={now} onPreview={onPreview} />
          ))}
        </FileGroup>
      )}
    </>
  );
}

function FileGroup({ kind, title, note, children }: { kind: string; title: string; note?: string | null; children: ReactNode }) {
  return (
    <section className="sec" data-part="file-group" data-kind={kind}>
      <h3 className="sech" data-part="sech">
        {title}
        {note && (
          <span className="sech-note" data-part="sech-note">
            {note}
          </span>
        )}
      </h3>
      <ul className="file-list" data-part="file-list">{children}</ul>
    </section>
  );
}

export function NeedsHome({ what }: { what: string }) {
  return (
    <p className="tab-empty" data-part="tab-empty">
      {what} need a Firstmate home. Set one in Settings to see this card's task folder, the files it mentions and its worker's progress updates.
    </p>
  );
}

function usePreview(path: string) {
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setPreview(null);
    setError(null);
    api
      .filePreview(path)
      .then((p) => alive && setPreview(p))
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [path]);
  return { preview, error };
}

function folderOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

interface PreviewPaneProps {
  entry: FileEntry;
  files: FileEntry[];
  now: number;
  linking: Linking;
  onPreview: (path: string | null) => void;
}

function PreviewPane({ entry, files, now, linking, onPreview }: PreviewPaneProps) {
  const { preview, error } = usePreview(entry.path);
  const onBack = () => onPreview(null);
  const onPath: PathAction = (raw) => {
    const target = raw.startsWith("/") || raw.startsWith("~/") ? raw : `${folderOf(entry.path)}/${raw.replace(/^\.\//, "")}`;
    const listed = files.find((f) => f.path === target);
    return listed ? () => openEntry(listed, onPreview) : () => void api.openFile(target);
  };
  return (
    <div className="file-preview" data-part="file-preview" data-key={entry.path}>
      <div className="preview-head" data-part="preview-head">
        <button type="button" className="back-link" data-part="back-link" data-control="file-back" onClick={onBack}>
          <ChevronLeft />
          All files
        </button>
        <h3 className="preview-name" data-part="preview-name">
          {entry.name}
        </h3>
        <span className="file-meta" data-part="file-meta">
          {entryMeta(entry, now, true)}
        </span>
        <FileActions entry={entry} wide />
      </div>
      {error && (
        <p className="error-text" data-part="error-text">
          {error}
        </p>
      )}
      {!preview && !error && <p className="muted" data-part="muted">Loading the preview…</p>}
      {preview?.truncated && (
        <p className="quiet-note" data-part="quiet-note">
          This file is {formatBytes(preview.size)}; only the start is shown. Open it to read the rest.
        </p>
      )}
      {preview?.kind === "image" && preview.dataUrl && (
        <div className="preview-image" data-part="preview-image">
          <img src={preview.dataUrl} alt={entry.name} />
        </div>
      )}
      {preview?.kind === "markdown" && preview.text !== null && <Markdown text={preview.text} linking={linking} onPath={onPath} className="md-doc" />}
      {preview?.kind === "text" && preview.text !== null && <pre className="preview-text" data-part="preview-text">{preview.text}</pre>}
    </div>
  );
}
