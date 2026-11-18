import { useRef, useState, type ReactNode } from "react";
import { ROW_ORDER, type Card, type Column, type MoveRequest, type Overlay, type Placement, type RowKey, type Worker } from "../api";
import { boardMinWidth, cardNote, clampWidth, columnTemplate, groupCards, insertAt, outcomeTag, renamedColumn, shownRequest } from "../board";
import { useCardDrag, type CardDrag } from "../cardDrag";
import type { DropTarget } from "../dropTarget";
import { startDrag } from "../drag";
import { ChevronLeft, ChevronRight, Sailor, Wave } from "./Icons";

interface BoardProps {
  cards: Card[];
  columns: Column[];
  overlay: Overlay;
  workers: Record<string, Worker>;
  rowNames: Record<RowKey, string>;
  selectedId: string | null;
  onSelect: (card: Card) => void;
  onColumnChange: (project: string, change: { width?: number; collapsed?: boolean }) => void;
  onColumnRename: (project: string, name: string) => void;
  onPlace: (placement: Placement) => void;
  onWatch: (card: Card, worker: Worker) => void;
}

export function Board({ cards, columns, overlay, workers, rowNames, selectedId, onSelect, onColumnChange, onColumnRename, onPlace, onWatch }: BoardProps) {
  const [liveWidths, setLiveWidths] = useState<Record<string, number>>({});
  const shown = columns.map((c) => (liveWidths[c.project] ? { ...c, width: liveWidths[c.project] } : c));
  const cells = groupCards(cards, shown, overlay);
  const template = columnTemplate(shown);
  const scroller = useRef<HTMLDivElement>(null);

  const idsAt = (project: string, row: RowKey) => (cells.get(project)?.get(row) ?? []).map((c) => c.id);
  const isOrigin = (card: Card, target: DropTarget) =>
    target.project === card.project && target.row === card.row && idsAt(card.project, card.row).indexOf(card.id) === target.index;

  const { drag, begin, justDragged } = useCardDrag(scroller, (card, target) => {
    if (isOrigin(card, target)) return;
    onPlace({
      cardId: card.id,
      title: card.title,
      project: target.project,
      fromRow: card.row,
      toRow: target.row,
      order: insertAt(idsAt(target.project, target.row), card.id, target.index),
    });
  });
  const slotFor = (project: string, row: RowKey) =>
    drag?.target && drag.target.project === project && drag.target.row === row && !isOrigin(drag.card, drag.target)
      ? drag.target.index
      : -1;

  const resize = (event: React.PointerEvent, column: Column) =>
    startDrag(
      event,
      (dx) => setLiveWidths((w) => ({ ...w, [column.project]: clampWidth(column.width + dx) })),
      (dx) => {
        onColumnChange(column.project, { width: clampWidth(column.width + dx) });
        setLiveWidths((w) => {
          const next = { ...w };
          delete next[column.project];
          return next;
        });
      },
    );

  return (
    <div className="board-scroll" ref={scroller}>
      <div className="board" style={{ minWidth: boardMinWidth(shown) }}>
        <div className="column-heads" style={{ gridTemplateColumns: template }}>
          <span className="column-heads-label">Projects →</span>
          <Wave />
          {shown.map((column) => {
            const total = ROW_ORDER.reduce((n, row) => n + (cells.get(column.project)?.get(row)?.length ?? 0), 0);
            return column.collapsed ? (
              <div key={column.project} className="column-head collapsed">
                <span className="count-badge" aria-label={`${total} cards in ${column.name}`}>
                  {total}
                </span>
                <button
                  className="ico wide"
                  onClick={() => onColumnChange(column.project, { collapsed: false })}
                  aria-label={`Expand ${column.name}`}
                  title={`Expand ${column.name}`}
                >
                  <ChevronRight />
                </button>
              </div>
            ) : (
              <div key={column.project} className="column-head">
                <ColumnName column={column} onRename={(name) => onColumnRename(column.project, name)} />
                <span className="column-total">{total}</span>
                <button
                  className="ico"
                  onClick={() => onColumnChange(column.project, { collapsed: true })}
                  aria-label={`Collapse ${column.name}`}
                  title={`Collapse ${column.name}`}
                >
                  <ChevronLeft />
                </button>
                <div
                  className="col-handle"
                  role="separator"
                  aria-label={`Resize ${column.name}`}
                  onPointerDown={(e) => resize(e, column)}
                />
              </div>
            );
          })}
        </div>
        {ROW_ORDER.map((row) => (
          <section
            key={row}
            className={`row row-${row}`}
            data-row={row}
            aria-label={rowNames[row]}
            style={{ gridTemplateColumns: template }}
          >
            <h2 className="row-name">{rowNames[row]}</h2>
            {shown.map((column) => {
              const here = cells.get(column.project)?.get(row) ?? [];
              const targeted = drag?.target?.project === column.project && drag.target.row === row;
              return (
                <div
                  key={column.project}
                  className={`cell${column.collapsed ? " cell-collapsed" : ""}${targeted ? " drop-target" : ""}`}
                  data-project={column.project}
                  data-row={row}
                  data-collapsed={column.collapsed}
                >
                  {column.collapsed
                    ? here.length > 0 && <span className="vname">{column.name}</span>
                    : withSlot(
                        here.map((card) => (
                          <CardView
                            key={card.id}
                            card={card}
                            request={shownRequest(card.id, overlay.requests)}
                            worker={workers[card.id]}
                            selected={card.id === selectedId}
                            lifted={drag?.card.id === card.id}
                            onPointerDown={(e) => begin(e, card)}
                            onSelect={(c) => !justDragged.current && onSelect(c)}
                            onWatch={onWatch}
                          />
                        )),
                        here,
                        drag,
                        slotFor(column.project, row),
                      )}
                </div>
              );
            })}
          </section>
        ))}
      </div>
      {drag && <Ghost drag={drag} request={shownRequest(drag.card.id, overlay.requests)} worker={workers[drag.card.id]} />}
    </div>
  );
}

function withSlot(views: ReactNode[], cards: Card[], drag: CardDrag | null, slot: number): ReactNode[] {
  if (!drag || slot < 0) return views;
  const placeholder = <div key="drop-slot" className="drop-slot" style={{ height: drag.height }} aria-hidden="true" />;
  const out: ReactNode[] = [];
  let seen = 0;
  cards.forEach((card, i) => {
    if (card.id !== drag.card.id) {
      if (seen === slot) out.push(placeholder);
      seen += 1;
    }
    out.push(views[i]);
  });
  if (slot >= seen) out.push(placeholder);
  return out;
}

function Ghost({ drag, request, worker }: { drag: CardDrag; request: MoveRequest | null; worker?: Worker }) {
  return (
    <div
      className={`card card-${drag.card.row} card-ghost`}
      style={{ left: drag.x - drag.offsetX, top: drag.y - drag.offsetY, width: drag.width }}
      aria-hidden="true"
    >
      <span className="card-open">
        <CardFace card={drag.card} request={request} />
      </span>
      {worker && (
        <span className={`sailor ${worker.status}`}>
          <Sailor />
        </span>
      )}
    </div>
  );
}

function ColumnName({ column, onRename }: { column: Column; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);

  if (!editing) {
    return (
      <button className="column-name" title={`Rename ${column.name}`} onClick={() => setEditing(true)}>
        {column.name}
      </button>
    );
  }

  return (
    <input
      className="column-name column-name-input"
      aria-label={`Name of ${column.name}`}
      defaultValue={column.name}
      autoFocus
      spellCheck={false}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Escape") cancelled.current = true;
        else if (e.key !== "Enter") return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.blur();
      }}
      onBlur={(e) => {
        const name = cancelled.current ? null : renamedColumn(column, e.currentTarget.value);
        cancelled.current = false;
        setEditing(false);
        if (name !== null) onRename(name);
      }}
    />
  );
}

interface CardViewProps {
  card: Card;
  request: MoveRequest | null;
  worker?: Worker;
  selected: boolean;
  lifted: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onSelect: (card: Card) => void;
  onWatch: (card: Card, worker: Worker) => void;
}

function CardView({ card, request, worker, selected, lifted, onPointerDown, onSelect, onWatch }: CardViewProps) {
  return (
    <div
      className={`card card-${card.row}${selected ? " selected" : ""}${lifted ? " lifted" : ""}`}
      data-id={card.id}
      onPointerDown={onPointerDown}
    >
      <button className="card-open" onClick={() => onSelect(card)}>
        <CardFace card={card} request={request} />
      </button>
      {worker && (
        <button
          className={`sailor ${worker.status}`}
          aria-label={WORKER_LABEL[worker.status]}
          title={WORKER_LABEL[worker.status]}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onWatch(card, worker)}
        >
          <Sailor />
        </button>
      )}
    </div>
  );
}

const WORKER_LABEL: Record<Worker["status"], string> = {
  working: "A crewmate is working on this. Open its terminal",
  idle: "A crewmate is on this, idle. Open its terminal",
};

function CardFace({ card, request }: { card: Card; request: MoveRequest | null }) {
  const note = cardNote(card);
  const tag = outcomeTag(card);
  return (
    <>
      <span className="bar" aria-hidden="true" />
      <span className="card-body">
        <span className="phrase">{card.title}</span>
        {note && <span className="card-note">{note}</span>}
        {tag && <span className="mark mark-reported">{tag}</span>}
        {request && <RequestMark request={request} />}
      </span>
    </>
  );
}

function RequestMark({ request }: { request: MoveRequest }) {
  switch (request.status) {
    case "sending":
    case "asked":
      return <span className="mark mark-asked">asked</span>;
    case "failed":
      return <span className="mark mark-failed">not sent</span>;
    case "answered":
      return (
        <span className="answer">
          <span className="mark mark-answered">answered</span>
          <span className="answer-text">{request.answer}</span>
        </span>
      );
    default:
      return null;
  }
}
