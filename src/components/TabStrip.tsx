import { useEffect, useState, type Ref, type RefObject, type WheelEvent } from "react";
import type { ShellTab } from "../api";
import { CHAT_TAB, stripClass, stripEdges } from "../terminalTabs";
import { states } from "../parts";
import { ChevronLeft, ChevronRight, Close, Plus, TerminalIcon } from "./Icons";

interface TabStripProps {
  title: string;
  chip: string | null;
  canChange: boolean;
  tabs: ShellTab[];
  active: string;
  launcherOpen: boolean;
  shortcut: string;
  hideTitle: string;
  stripRef: RefObject<HTMLDivElement | null>;
  addRef?: Ref<HTMLButtonElement>;
  onActivate: (key: string) => void;
  onCloseTab: (tab: ShellTab) => void;
  onLauncher: () => void;
  onChange: () => void;
  onCollapse: () => void;
}

const NO_EDGES = { left: false, right: false };

function useStripEdges(stripRef: RefObject<HTMLDivElement | null>, layoutKey: string) {
  const [edges, setEdges] = useState(NO_EDGES);
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const update = () => setEdges((prev) => {
      const next = stripEdges(strip);
      return next.left === prev.left && next.right === prev.right ? prev : next;
    });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(strip);
    strip.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      strip.removeEventListener("scroll", update);
    };
  }, [stripRef, layoutKey]);
  return edges;
}

function scrollSideways(e: WheelEvent<HTMLDivElement>) {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
}

export function TabStrip({ title, chip, canChange, tabs, active, launcherOpen, shortcut, hideTitle, stripRef, addRef, onActivate, onCloseTab, onLauncher, onChange, onCollapse }: TabStripProps) {
  const chatActive = active === CHAT_TAB;
  const tabClass = (key: string) => (key === active ? "tab on" : "tab");
  const tabParts = (key: string) => ({ "data-part": "tab", "data-state": states({ active: key === active }), "data-key": key });
  const edges = useStripEdges(stripRef, [active, chip, ...tabs.map((t) => t.name)].join("\n"));
  return (
    <div className="chat-head" data-part="chat-head">
      <div
        ref={stripRef}
        className={stripClass(edges)}
        data-part="tab-strip"
        data-state={states({ "more-left": edges.left, "more-right": edges.right })}
        role="tablist"
        aria-label="Terminals"
        onWheel={scrollSideways}
      >
        <div className={tabClass(CHAT_TAB)} {...tabParts(CHAT_TAB)} data-tab={CHAT_TAB}>
          <button role="tab" aria-selected={chatActive} className="tab-label" data-part="tab-label" data-control="terminal-tab" onClick={() => onActivate(CHAT_TAB)}>
            {title}
          </button>
          {chatActive && chip && <span className="terminal-chip" data-part="terminal-chip">{chip}</span>}
        </div>
        {tabs.map((tab) => (
          <div key={tab.terminal} className={tabClass(tab.terminal)} {...tabParts(tab.terminal)} data-tab={tab.terminal} title={tab.folder}>
            <button
              role="tab"
              aria-selected={tab.terminal === active}
              className="tab-label"
              data-part="tab-label"
              data-control="terminal-tab"
              onClick={() => onActivate(tab.terminal)}
            >
              <TerminalIcon />
              {tab.name}
            </button>
            <button
              className="tab-close"
              data-part="tab-close"
              data-control="terminal-tab-close"
              aria-label={`Close ${tab.name}`}
              title="Close tab. The terminal keeps running."
              onClick={() => onCloseTab(tab)}
            >
              <Close />
            </button>
          </div>
        ))}
      </div>
      <button
        ref={addRef}
        className="ico tab-add"
        data-part="icon-button"
        data-control="launcher-toggle"
        aria-label="Open a terminal"
        aria-expanded={launcherOpen}
        title={`Open a terminal (${shortcut})`}
        onClick={onLauncher}
      >
        <Plus />
      </button>
      <span className="spacer" data-part="spacer" />
      {chatActive && canChange && (
        <button className="mini" data-part="mini-button" data-control="chat-change-terminal" onClick={onChange}>
          Change
        </button>
      )}
      <button className="chat-hide" data-part="chat-hide" data-control="chat-hide" onClick={onCollapse} aria-label="Hide chat" title={hideTitle}>
        <ChevronRight />
      </button>
    </div>
  );
}

export function ChatRail({ name, title, inert, onOpen }: { name: string; title: string; inert: boolean; onOpen: () => void }) {
  return (
    <button className="chat-rail" data-part="chat-rail" data-control="chat-show" onClick={onOpen} aria-label={`Show chat: ${name}`} title={title} inert={inert}>
      <span className="chat-rail-caret" data-part="chat-rail-caret">
        <ChevronLeft />
      </span>
      <span className="vname" data-part="chat-rail-name">{name}</span>
    </button>
  );
}
