import type { ReactNode } from "react";
import { api } from "../api";
import { fileName, splitText, type Linking, type Piece } from "../links";
import type { PathAction } from "./Markdown";

const CODE_SPAN = /(`[^`\n]+`)/;

interface WebAnchorProps {
  url: string;
  title?: string;
  className?: string;
  part?: string;
  control?: string;
  children: ReactNode;
}

export function WebAnchor({ url, title, className, part = "inline-link", control = "content-link", children }: WebAnchorProps) {
  return (
    <a
      className={`inline-link ${className ?? ""}`}
      data-part={part}
      data-control={control}
      data-key={url}
      href={url}
      title={title ?? url}
      onClick={(e) => {
        e.preventDefault();
        void api.openLink(url);
      }}
    >
      {children}
    </a>
  );
}

export function RichText({ text, linking, onPath }: { text: string; linking: Linking; onPath: PathAction }) {
  return (
    <span data-part="rich-text">
      {text.split(CODE_SPAN).map((part, i) => {
        if (!part) return null;
        if (CODE_SPAN.test(part) && part.startsWith("`")) {
          const inner = part.slice(1, -1);
          const pieces = splitText(inner.trim(), linking);
          const code = <code>{inner}</code>;
          return pieces.length === 1 && pieces[0].type !== "text" ? (
            <PieceView key={i} piece={pieces[0]} onPath={onPath} shown={code} />
          ) : (
            <code key={i}>{inner}</code>
          );
        }
        return splitText(part, linking).map((piece, j) => <PieceView key={`${i}-${j}`} piece={piece} onPath={onPath} />);
      })}
    </span>
  );
}

function PieceView({ piece, onPath, shown }: { piece: Piece; onPath: PathAction; shown?: ReactNode }) {
  if (piece.type === "text") return <>{piece.text}</>;
  if (piece.type === "link") {
    return (
      <WebAnchor url={piece.link.url} title={piece.text}>
        {shown ?? piece.label ?? (piece.link.kind === "ticket" && !piece.text.includes("/") ? piece.text : piece.link.label)}
      </WebAnchor>
    );
  }
  const open = onPath(piece.path);
  if (!open) return <>{shown ?? piece.text}</>;
  return (
    <button type="button" className="inline-link path-link" data-part="path-link" data-control="content-path" data-key={piece.path} title={piece.path} onClick={open}>
      {shown ?? piece.label ?? fileName(piece.path)}
    </button>
  );
}
