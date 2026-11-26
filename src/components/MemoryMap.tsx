import { useLayoutEffect, useRef, useState } from "react";
import { formatMemory } from "../memory";
import { blockLines, IDLE_TAG, isHeavy, KIND_NAMES, KIND_ORDER, percentOf, ROOMY, squarify, thresholdText, tokensText, type ItemKind, type MapItem } from "../machine";
import { states } from "../parts";

const GAP = 2;
const MIN_HEIGHT = 260;
const MAX_HEIGHT = 360;
const HEIGHT_RATIO = 0.42;
const NARROW = 520;
const NARROW_RATIO = 1.1;

interface MemoryMapProps {
  items: MapItem[];
  total: number;
  selectedId: string;
  idleIds: Set<string>;
  thresholdMb: number;
  onSelect: (id: string) => void;
}

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function MemoryMap({ items, total, selectedId, idleIds, thresholdMb, onSelect }: MemoryMapProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const height = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, width * (width < NARROW ? NARROW_RATIO : HEIGHT_RATIO))));
  const placed = width > 0 ? squarify(items.map((item) => ({ value: item.bytes, item })), { x: 0, y: 0, w: width, h: height }) : [];
  const kinds = KIND_ORDER.filter((kind) => items.some((i) => i.kind === kind));
  return (
    <>
      <div ref={ref} className="mem-map" data-part="mem-map" role="group" aria-label="Memory map: area is memory" style={{ height }}>
        {placed.map(({ item, rect }) => (
          <Block
            key={item.id}
            item={item}
            total={total}
            width={rect.w - GAP}
            height={rect.h - GAP}
            left={rect.x + GAP / 2}
            top={rect.y + GAP / 2}
            selected={item.id === selectedId}
            idle={idleIds.has(item.id)}
            heavy={item.kind !== "rest" && isHeavy(item.bytes, thresholdMb)}
            onSelect={onSelect}
          />
        ))}
      </div>
      <div className="dash-legend" data-part="dash-legend">
        {kinds.map((kind) => (
          <LegendItem key={kind} kind={kind} label={KIND_NAMES[kind]} />
        ))}
        <LegendItem kind="flagged" label={`Over ${thresholdText(thresholdMb)} or idle`} />
      </div>
    </>
  );
}

export function LegendItem({ kind, label, value }: { kind: ItemKind | "flagged" | "available"; label: string; value?: string }) {
  return (
    <span className="legend-item" data-part="legend-item">
      <i className="legend-swatch" data-part="legend-swatch" data-kind={kind} aria-hidden="true" />
      {label}
      {value && (
        <b className="legend-value" data-part="legend-value">
          {value}
        </b>
      )}
    </span>
  );
}

interface BlockProps {
  item: MapItem;
  total: number;
  width: number;
  height: number;
  left: number;
  top: number;
  selected: boolean;
  idle: boolean;
  heavy: boolean;
  onSelect: (id: string) => void;
}

function Block({ item, total, width, height, left, top, selected, idle, heavy, onSelect }: BlockProps) {
  const size = `${formatMemory(item.bytes)} · ${percentOf(item.bytes, total)}`;
  const tokens = item.group?.session ? tokensText(item.group.session.contextTokens) : "";
  const roomy = width >= ROOMY;
  const fits = blockLines(item.name, width, height, roomy);
  const showName = fits.name;
  const showSize = fits.size;
  const showMore = fits.more;
  const showTag = idle && fits.tag;
  const shownSize = roomy ? size : formatMemory(item.bytes);
  const title = [`${item.name}: ${formatMemory(item.bytes)}`, tokens && `context ${tokens}`, idle && "idle, holding memory", item.note].filter(Boolean).join("\n");
  const state = states({ selected, heavy, idle, roomy });
  return (
    <div className="map-cell" data-part="map-cell" data-state={state} style={{ left, top, width: Math.max(width, 0), height: Math.max(height, 0) }}>
      <button
        type="button"
        className="map-block"
        data-part="map-block"
        data-control="map-block"
        data-kind={item.kind}
        data-id={item.id}
        data-state={state}
        aria-pressed={selected}
        aria-label={`${item.name}, ${size}${tokens ? `, ${tokens}` : ""}${idle ? ", idle and holding memory" : ""}`}
        title={title}
        onClick={() => onSelect(item.id)}
      />
      <span className="map-label" data-part="map-label" data-kind={item.kind} data-state={state} aria-hidden="true">
        {showName && (
          <span className="map-name" data-part="map-name">
            {item.name}
          </span>
        )}
        {showSize && (
          <span className="map-size" data-part="map-size">
            {shownSize}
          </span>
        )}
        {showMore && item.note && (
          <span className="map-note" data-part="map-note">
            {item.note}
          </span>
        )}
        {showMore && tokens && (
          <span className="map-tokens" data-part="map-tokens">
            {tokens}
          </span>
        )}
        {showTag && (
          <span className="map-tag" data-part="map-tag">
            {IDLE_TAG}
          </span>
        )}
      </span>
    </div>
  );
}
