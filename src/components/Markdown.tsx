import { useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { describeUrl, fileName, splitText, type Linking, type Piece } from "../links";
import { WebAnchor } from "./RichText";

export type PathAction = (path: string) => (() => void) | null;

interface MarkdownProps {
  text: string;
  linking: Linking;
  onPath: PathAction;
  className?: string;
}

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
}

const LOCAL = "local:";
const WEB = /^https?:/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const BLOCK_PARENTS = ["root", "blockquote", "listItem"];
const SKIPPED = ["link", "linkReference", "code", "inlineCode"];

export function Markdown({ text, linking, onPath, className }: MarkdownProps) {
  const plugins = useMemo(() => [remarkGfm, remarkBreaks, () => (tree: MdNode) => linkify(tree, linking)], [linking]);
  const components = useMemo<Components>(
    () => ({
      a: ({ href, children }) => <MdLink href={href ?? ""} onPath={onPath}>{children}</MdLink>,
      img: ({ src, alt }) => <MdImage src={typeof src === "string" ? src : ""} alt={alt ?? ""} onPath={onPath} />,
    }),
    [onPath],
  );
  return (
    <div className={`md ${className ?? ""}`}>
      <ReactMarkdown remarkPlugins={plugins} components={components} urlTransform={toTarget}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

function toTarget(url: string): string {
  if (WEB.test(url) || url.startsWith(LOCAL)) return url;
  if (SCHEME.test(url) || url.startsWith("#") || !url) return "";
  return LOCAL + url;
}

function linkify(node: MdNode, linking: Linking) {
  if (!node.children || SKIPPED.includes(node.type)) return;
  const block = BLOCK_PARENTS.includes(node.type);
  node.children = node.children.flatMap((child): MdNode[] => {
    if (child.type === "html") {
      const inline = toNodes(splitText(child.value ?? "", linking));
      return block ? [{ type: "paragraph", children: inline }] : inline;
    }
    if (child.type === "text") return toNodes(splitText(child.value ?? "", linking));
    if (child.type === "inlineCode") {
      const pieces = splitText((child.value ?? "").trim(), linking);
      const only = pieces.length === 1 ? pieces[0] : null;
      return only && only.type !== "text" ? [{ type: "link", url: pieceTarget(only), children: [child] }] : [child];
    }
    linkify(child, linking);
    return [child];
  });
}

function pieceTarget(piece: Exclude<Piece, { type: "text" }>): string {
  return piece.type === "link" ? piece.link.url : LOCAL + piece.path;
}

function toNodes(pieces: Piece[]): MdNode[] {
  return pieces.map((piece) => {
    if (piece.type === "text") return { type: "text", value: piece.text };
    return { type: "link", url: pieceTarget(piece), children: [{ type: "text", value: piece.label ?? piece.text }] };
  });
}

function MdLink({ href, onPath, children }: { href: string; onPath: PathAction; children: ReactNode }) {
  if (WEB.test(href)) {
    const link = describeUrl(href);
    const bare = typeof children === "string" && (children === href || WEB.test(children));
    return (
      <WebAnchor url={link?.url ?? href} title={href}>
        {bare && link ? link.label : children}
      </WebAnchor>
    );
  }
  if (href.startsWith(LOCAL)) {
    const path = href.slice(LOCAL.length);
    const open = onPath(path);
    const shown = typeof children === "string" && children === path ? fileName(path) : children;
    if (open)
      return (
        <button type="button" className="inline-link path-link" title={path} onClick={open}>
          {shown}
        </button>
      );
    return <span title={path}>{children}</span>;
  }
  return <span>{children}</span>;
}

function MdImage({ src, alt, onPath }: { src: string; alt: string; onPath: PathAction }) {
  const name = alt || fileName(src.replace(LOCAL, "")) || "image";
  const open = src.startsWith(LOCAL) ? onPath(src.slice(LOCAL.length)) : null;
  if (open)
    return (
      <button type="button" className="inline-link md-image" onClick={open} title={src.slice(LOCAL.length)}>
        Image: {name}
      </button>
    );
  return <span className="md-image" title={WEB.test(src) ? src : undefined}>Image: {name}</span>;
}
