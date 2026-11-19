import { useEffect, useState, type Ref, type RefObject, type WheelEvent } from "react";
import type { ShellTab } from "../api";
import { CHAT_TAB, stripClass, stripEdges } from "../terminalTabs";
import { ChevronLeft, ChevronRight, Close, Plus, TerminalIcon } from "./Icons";

interface TabStripProps {
  title: string;
  chip: string | null;
  canChange: boolean;
  tabs: ShellTab[];
  active: string;
  launcherOpen: boolean;
  shortcut: string;
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

export function TabStrip({ title, chip, canChange, tabs, active, launcherOpen, shortcut, stripRef, addRef, onActivate, onCloseTab, onLauncher, onChange, onCollapse }: TabStripProps) {
  const chatActive = active === CHAT_TAB;
  const tabClass = (key: string) => (key === active ? "tab on" : "tab");
  const edges = useStripEdges(stripRef, [active, chip, ...tabs.map((t) => t.name)].join("\n"));
  return (
    <div className="chat-head">
      <div ref={stripRef} className={stripClass(edges)} role="tablist" aria-label="Terminals" onWheel={scrollSideways}>
        <div className={tabClass(CHAT_TAB)} data-tab={CHAT_TAB}>
          <button role="tab" aria-selected={chatActive} className="tab-label" onClick={() => onActivate(CHAT_TAB)}>
            {title}
          </button>
          {chatActive && chip && <span className="terminal-chip">{chip}</span>}
        </div>
        {tabs.map((tab) => (
          <div key={tab.terminal} className={tabClass(tab.terminal)} data-tab={tab.terminal} title={tab.folder}>
            <button role="tab" aria-selected={tab.terminal === active} className="tab-label" onClick={() => onActivate(tab.terminal)}>
              <TerminalIcon />
              {tab.name}
            </button>
            <button className="tab-close" aria-label={`Close ${tab.name}`} title="Close tab. The terminal keeps running." onClick={() => onCloseTab(tab)}>
              <Close />
            </button>
          </div>
        ))}
      </div>
      <button
        ref={addRef}
        className="ico tab-add"
        aria-label="Open a terminal"
        aria-expanded={launcherOpen}
        title={`Open a terminal (${shortcut})`}
        onClick={onLauncher}
      >
        <Plus />
      </button>
      <span className="spacer" />
      {chatActive && canChange && (
        <button className="mini" onClick={onChange}>
          Change
        </button>
      )}
      <button className="ico" onClick={onCollapse} aria-label="Collapse chat" title="Collapse chat">
        <ChevronRight />
      </button>
    </div>
  );
}

export function ChatRail({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <button className="chat-rail" onClick={onOpen} aria-label={`Open ${name}`}>
      <ChevronLeft />
      <span className="vname">{name}</span>
    </button>
  );
}
