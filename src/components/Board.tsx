import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { ROW_ORDER, type Card, type Column, type MoveRequest, type MoveTo, type Overlay, type Placement, type RowKey, type Worker } from "../api";
import {
  boardMinWidth,
  cardNote,
  cellCount,
  clampWidth,
  columnTemplate,
  groupCards,
  headTemplate,
  insertAt,
  renamedColumn,
  shownRequest,
} from "../board";
import { deletePlan, moveTargets, NEW_COLUMN, nextDraft, startDraft } from "../columnDelete";
import { useCardDrag, type CardDrag } from "../cardDrag";
import type { DropTarget } from "../dropTarget";
import { startDrag } from "../drag";
import { ChevronLeft, ChevronRight, Plus, Sailor, Trash, Wave } from "./Icons";

interface BoardProps {
  cards: Card[];
  columns: Column[];
  overlay: Overlay;
  workers: Record<string, Worker>;
  rowNames: Record<RowKey, string>;
  selectedId: string | null;
  onSelect: (card: Card) => void;
  onColumnChange: (id: number, change: { width?: number; collapsed?: boolean }) => void;
  onColumnRename: (id: number, name: string) => void;
  onColumnAdd: (name: string) => void;
  onColumnDelete: (id: number, moveTo?: MoveTo) => Promise<void>;
  onPlace: (placement: Placement) => void;
  onWatch: (card: Card, worker: Worker) => void;
}

export function Board(props: BoardProps) {
  const { cards, columns, overlay, workers, rowNames, selectedId, onSelect, onColumnChange, onColumnRename, onPlace, onWatch } = props;
  const [liveWidths, setLiveWidths] = useState<Record<number, number>>({});
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const deleting = columns.find((c) => c.id === deletingId);
  const shown = columns.map((c) => (liveWidths[c.id] ? { ...c, width: liveWidths[c.id] } : c));
  const cells = groupCards(cards, shown, overlay);
  const template = columnTemplate(shown);
  const scroller = useRef<HTMLDivElement>(null);

  const idsAt = (column: number, row: RowKey) => (cells.get(column)?.get(row) ?? []).map((c) => c.id);
  const isOrigin = (card: Card, target: DropTarget) => idsAt(target.column, target.row).indexOf(card.id) === target.index;

  const { drag, begin, justDragged } = useCardDrag(scroller, (card, target) => {
    if (isOrigin(card, target)) return;
    onPlace({
      cardId: card.id,
      title: card.title,
      column: target.column,
      fromRow: card.row,
      toRow: target.row,
      order: insertAt(idsAt(target.column, target.row), card.id, target.index),
    });
  });
  const slotFor = (column: number, row: RowKey) =>
    drag?.target && drag.target.column === column && drag.target.row === row && !isOrigin(drag.card, drag.target)
      ? drag.target.index
      : -1;

  const resize = (event: React.PointerEvent, column: Column) =>
    startDrag(
      event,
      (dx) => setLiveWidths((w) => ({ ...w, [column.id]: clampWidth(column.width + dx) })),
      (dx) => {
        onColumnChange(column.id, { width: clampWidth(column.width + dx) });
        setLiveWidths((w) => {
          const next = { ...w };
          delete next[column.id];
          return next;
        });
      },
    );

  return (
    <div className="board-scroll" ref={scroller}>
      <div className="board" style={{ minWidth: boardMinWidth(shown) }}>
        <div className="column-heads" style={{ gridTemplateColumns: headTemplate(shown) }}>
          <span className="column-heads-label">Projects →</span>
          <Wave />
          {shown.map((column) => {
            const total = cellCount(cells, column.id);
            return column.collapsed ? (
              <div key={column.id} className="column-head collapsed">
                <span className="count-badge" aria-label={`${total} cards in ${column.name}`}>
                  {total}
                </span>
                <button
                  className="ico wide"
                  onClick={() => onColumnChange(column.id, { collapsed: false })}
                  aria-label={`Expand ${column.name}`}
                  title={`Expand ${column.name}`}
                >
                  <ChevronRight />
                </button>
              </div>
            ) : (
              <div key={column.id} className="column-head">
                <ColumnName column={column} onRename={(name) => onColumnRename(column.id, name)} />
                <span className="column-total">{total}</span>
                <button
                  className="ico column-delete"
                  onClick={() => setDeletingId(column.id)}
                  aria-label={`Delete ${column.name}`}
                  title={`Delete ${column.name}`}
                >
                  <Trash />
                </button>
                <button
                  className="ico"
                  onClick={() => onColumnChange(column.id, { collapsed: true })}
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
          <AddColumn onAdd={props.onColumnAdd} />
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
              const here = cells.get(column.id)?.get(row) ?? [];
              const targeted = drag?.target?.column === column.id && drag.target.row === row;
              return (
                <div
                  key={column.id}
                  className={`cell${column.collapsed ? " cell-collapsed" : ""}${targeted ? " drop-target" : ""}`}
                  data-column={column.id}
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
                        slotFor(column.id, row),
                      )}
                </div>
              );
            })}
          </section>
        ))}
      </div>
      {drag && <Ghost drag={drag} request={shownRequest(drag.card.id, overlay.requests)} worker={workers[drag.card.id]} />}
      {deleting && (
        <DeleteColumnDialog
          column={deleting}
          held={cellCount(cells, deleting.id)}
          targets={moveTargets(columns, deleting.id)}
          onDelete={(moveTo) => props.onColumnDelete(deleting.id, moveTo).then(() => setDeletingId(null))}
          onClose={() => setDeletingId(null)}
        />
      )}
    </div>
  );
}

function AddColumn({ onAdd }: { onAdd: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);

  return (
    <div className="column-head">
      {editing ? (
        <input
          className="column-name column-name-input"
          aria-label="Name of the new column"
          placeholder="Column name"
          autoFocus
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Escape") cancelled.current = true;
            else if (e.key !== "Enter") return;
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.blur();
          }}
          onBlur={(e) => {
            const name = cancelled.current ? "" : e.currentTarget.value.trim();
            cancelled.current = false;
            setEditing(false);
            if (name) onAdd(name);
          }}
        />
      ) : (
        <button className="column-add" onClick={() => setEditing(true)}>
          <Plus />
          Add column
        </button>
      )}
    </div>
  );
}

interface DeleteColumnDialogProps {
  column: Column;
  held: number;
  targets: Column[];
  onDelete: (moveTo?: MoveTo) => Promise<void>;
  onClose: () => void;
}

function DeleteColumnDialog({ column, held, targets, onDelete, onClose }: DeleteColumnDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => dialogRef.current?.showModal(), []);
  const [draft, dispatch] = useReducer(nextDraft, targets, startDraft);
  const { moving, choice, moveTo, ready } = deletePlan(held, targets, draft);

  const submit = () => {
    if (!ready) return;
    dispatch({ type: "submit" });
    onDelete(moveTo).catch((e) => dispatch({ type: "fail", error: String(e) }));
  };

  return (
    <dialog ref={dialogRef} className="confirm" onCancel={onClose} aria-label={`Delete ${column.name}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2>Delete {column.name}?</h2>
        {moving && (
          <>
            <p>
              {held === 1 ? "It holds 1 card, which moves" : `It holds ${held} cards, which move`} to the end of the column you pick. Then this
              column is deleted.
            </p>
            <div className="confirm-move">
              <label className="field">
                <span>Move the cards to</span>
                <select
                  className="text-input"
                  value={String(choice)}
                  disabled={draft.busy}
                  autoFocus
                  onChange={(e) => dispatch({ type: "pick", choice: e.target.value === NEW_COLUMN ? NEW_COLUMN : Number(e.target.value) })}
                >
                  {targets.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  <option value={NEW_COLUMN}>New column</option>
                </select>
              </label>
              {choice === NEW_COLUMN && (
                <input
                  className="text-input"
                  aria-label="Name of the new column"
                  placeholder="Column name"
                  value={draft.name}
                  disabled={draft.busy}
                  autoFocus
                  spellCheck={false}
                  onChange={(e) => dispatch({ type: "name", name: e.target.value })}
                />
              )}
            </div>
          </>
        )}
        <p>
          {column.project === null ? (
            "The column leaves the board for good."
          ) : (
            <>
              The column leaves the board. Firstmate's tasks for <span className="confirm-name">{column.project}</span> are not changed. It
              comes back only if a new <span className="confirm-name">{column.project}</span> task has no other column to show in.
            </>
          )}
        </p>
        {draft.error && (
          <div className="error-text" role="alert">
            Could not delete the column: {draft.error}
          </div>
        )}
        <div className="confirm-foot">
          <button type="button" className="btn" onClick={onClose} autoFocus={!moving}>
            Cancel
          </button>
          <button type="submit" className="btn btn-danger" disabled={!ready}>
            {moving ? "Move and delete" : "Delete column"}
          </button>
        </div>
      </form>
    </dialog>
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
  return (
    <>
      <span className="bar" aria-hidden="true" />
      <span className="card-body">
        <span className="phrase">{card.title}</span>
        {note && <span className="card-note">{note}</span>}
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
