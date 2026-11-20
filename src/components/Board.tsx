import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { ROW_ORDER, type AgentFilter, type Card, type Column, type MoveRequest, type MoveTo, type Overlay, type Placement, type RowKey, type SourceKind, type Worker } from "../api";
import {
  boardMinWidth,
  cardNote,
  cellCount,
  clampWidth,
  columnTemplate,
  groupCards,
  headTemplate,
  insertAmongShown,
  isUnnamed,
  outcomeTag,
  renamedColumn,
  rowCount,
  shownRequest,
} from "../board";
import { anyCard, keepCards, noMatchText, shownByAgent } from "../agentFilter";
import { columnHasUnseen, isUnseen, rowHasUnseen, type CardUpdates } from "../updates";
import { projectTasks, sailorLabel } from "../source";
import { deletePlan, moveTargets, NEW_COLUMN, nextDraft, startDraft } from "../columnDelete";
import { useCardDrag, type CardDrag } from "../cardDrag";
import { useColumnDrag, type ColumnDrag } from "../columnDrag";
import type { DropTarget } from "../dropTarget";
import { startDrag } from "../drag";
import { ChevronDown, ChevronLeft, ChevronRight, Plus, Sailor, Trash } from "./Icons";

interface BoardProps {
  cards: Card[];
  source: SourceKind;
  columns: Column[];
  overlay: Overlay;
  workers: Record<string, Worker>;
  updates: CardUpdates;
  rowNames: Record<RowKey, string>;
  collapsedRows: RowKey[];
  agentFilter: AgentFilter;
  projectsFiltered: boolean;
  selectedId: string | null;
  onSelect: (card: Card) => void;
  onColumnChange: (id: number, change: { width?: number; collapsed?: boolean }) => void;
  onRowCollapse: (row: RowKey, collapsed: boolean) => void;
  onShowEveryCard: () => void;
  onColumnRename: (id: number, name: string) => void;
  onColumnMove: (id: number, index: number) => void;
  onColumnAdd?: (name: string) => void;
  onColumnDelete: (id: number, moveTo?: MoveTo) => Promise<void>;
  onPlace: (placement: Placement) => void;
  onWatch: (card: Card, worker: Worker) => void;
}

export function Board(props: BoardProps) {
  const { cards, source, columns, overlay, workers, updates, rowNames, collapsedRows, agentFilter, selectedId, onSelect, onColumnChange, onColumnRename, onPlace, onWatch } =
    props;
  const [liveWidths, setLiveWidths] = useState<Record<number, number>>({});
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const deleting = columns.find((c) => c.id === deletingId);
  const shown = columns.map((c) => (liveWidths[c.id] ? { ...c, width: liveWidths[c.id] } : c));
  const allCells = groupCards(cards, shown, overlay);
  const cells = agentFilter === "all" ? allCells : keepCards(allCells, (card) => shownByAgent(workers[card.id], agentFilter));
  const template = columnTemplate(shown);
  const scroller = useRef<HTMLDivElement>(null);

  const idsIn = (from: typeof cells, column: number, row: RowKey) => (from.get(column)?.get(row) ?? []).map((c) => c.id);
  const idsAt = (column: number, row: RowKey) => idsIn(cells, column, row);
  const isOrigin = (card: Card, target: DropTarget) => idsAt(target.column, target.row).indexOf(card.id) === target.index;

  const { drag, begin, justDragged } = useCardDrag(scroller, (card, target) => {
    if (isOrigin(card, target)) return;
    onPlace({
      cardId: card.id,
      title: card.title,
      column: target.column,
      fromRow: card.row,
      toRow: target.row,
      order: insertAmongShown(idsIn(allCells, target.column, target.row), idsAt(target.column, target.row), card.id, target.index),
    });
  });
  const columnDrag = useColumnDrag(scroller, (column, index) => props.onColumnMove(column.id, index));
  const liftedColumn = columnDrag.drag?.column.id;
  const headClass = (column: Column, unseen = false) =>
    `column-head${column.collapsed ? " collapsed" : ""}${unseen ? " unseen" : ""}${column.id === liftedColumn ? " column-lifted" : ""}`;
  const headProps = (column: Column) => ({
    "data-column": column.id,
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => columnDrag.begin(e, column),
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

  const lastOpenRow = [...ROW_ORDER].reverse().find((row) => !collapsedRows.includes(row));

  if (agentFilter !== "all" && !anyCard(cells)) {
    return (
      <div className="board-empty board-no-match" role="status">
        <p>{noMatchText(agentFilter, props.projectsFiltered)}</p>
        <button className="mini" onClick={props.onShowEveryCard}>
          Show every card
        </button>
      </div>
    );
  }

  return (
    <div className="board-scroll" ref={scroller}>
      <div className="board" style={{ minWidth: boardMinWidth(shown) }}>
        <div className="column-heads" style={{ gridTemplateColumns: headTemplate(shown) }}>
          <span className="column-heads-label">Projects →</span>
          {shown.map((column) => {
            const total = cellCount(cells, column.id);
            const unseen = column.collapsed && columnHasUnseen(cells, column.id, updates);
            const expand = unseen ? `Expand ${column.name}, it has a new update` : `Expand ${column.name}`;
            return column.collapsed ? (
              <div key={column.id} className={headClass(column, unseen)} {...headProps(column)}>
                <span className="count-badge" aria-label={`${total} cards in ${column.name}${unseen ? ", with a new update" : ""}`}>
                  {total}
                </span>
                <button
                  className="ico wide"
                  onClick={() => onColumnChange(column.id, { collapsed: false })}
                  aria-label={expand}
                  title={expand}
                >
                  <ChevronRight />
                </button>
              </div>
            ) : (
              <div key={column.id} className={headClass(column)} {...headProps(column)}>
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
          {props.onColumnAdd && <AddColumn onAdd={props.onColumnAdd} />}
        </div>
        {ROW_ORDER.map((row) => {
          const folded = collapsedRows.includes(row);
          const fill = row === lastOpenRow;
          const name = rowNames[row];
          const total = rowCount(cells, row);
          const unseen = folded && rowHasUnseen(cells, row, updates);
          const cardsText = total === 1 ? "1 card" : `${total} cards`;
          return (
            <section
              key={row}
              className={`row row-${row}${folded ? " row-collapsed" : ""}${unseen ? " unseen" : ""}${fill ? " row-fill" : ""}`}
              data-row={row}
              aria-label={name}
              style={{ gridTemplateColumns: template }}
            >
              <h2 className="row-name">
                <button
                  className="row-toggle"
                  aria-expanded={!folded}
                  aria-label={folded ? `Expand ${name}, ${cardsText}${unseen ? ", it has a new update" : ""}` : `Collapse ${name}`}
                  title={folded ? `Expand ${name}${unseen ? ", it has a new update" : ""}` : `Collapse ${name}`}
                  onClick={() => props.onRowCollapse(row, !folded)}
                >
                  {folded ? <ChevronRight /> : <ChevronDown />}
                  <span className="row-label">{name}</span>
                  {folded && <span className="row-count">{total}</span>}
                </button>
              </h2>
              {shown.map((column) => {
                const here = cells.get(column.id)?.get(row) ?? [];
                const targeted = drag?.target?.column === column.id && drag.target.row === row;
                return (
                  <div
                    key={column.id}
                    className={`cell${column.collapsed ? " cell-collapsed" : ""}${targeted ? " drop-target" : ""}${column.id === liftedColumn ? " column-lifted" : ""}`}
                    data-column={column.id}
                    data-row={row}
                    data-collapsed={column.collapsed || folded}
                    onPointerDown={column.collapsed ? (e) => columnDrag.begin(e, column) : undefined}
                  >
                    {folded
                      ? null
                      : column.collapsed
                        ? here.length > 0 && <span className="vname">{column.name}</span>
                        : withSlot(
                            here.map((card) => (
                              <CardView
                                key={card.id}
                                card={card}
                                request={shownRequest(card.id, overlay.requests)}
                                worker={workers[card.id]}
                                source={source}
                                unseen={isUnseen(updates, card.id)}
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
          );
        })}
        {columnDrag.drag?.slotX != null && (
          <div className="drop-slot column-slot" style={{ left: columnDrag.drag.slotX }} aria-hidden="true" />
        )}
      </div>
      {drag && <Ghost drag={drag} request={shownRequest(drag.card.id, overlay.requests)} worker={workers[drag.card.id]} />}
      {columnDrag.drag && <ColumnGhost drag={columnDrag.drag} />}
      {deleting && (
        <DeleteColumnDialog
          column={deleting}
          source={props.source}
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
  source: SourceKind;
  held: number;
  targets: Column[];
  onDelete: (moveTo?: MoveTo) => Promise<void>;
  onClose: () => void;
}

function DeleteColumnDialog({ column, source, held, targets, onDelete, onClose }: DeleteColumnDialogProps) {
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
              The column leaves the board. {projectTasks(source)} for <span className="confirm-name">{column.project}</span> are not changed. It
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

function ColumnGhost({ drag }: { drag: ColumnDrag }) {
  return (
    <div
      className="column-head column-ghost card-ghost"
      style={{ left: drag.x - drag.offsetX, top: drag.y - drag.offsetY, minWidth: drag.width }}
      aria-hidden="true"
    >
      <span className="column-name">{drag.column.name}</span>
    </div>
  );
}

const UNNAMED_COLUMN = "Unnamed";

function ColumnName({ column, onRename }: { column: Column; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);
  const unnamed = isUnnamed(column);

  if (!editing) {
    return (
      <button
        className={unnamed ? "column-name unnamed" : "column-name"}
        title={unnamed ? "Rename this unnamed column" : `Rename ${column.name}`}
        onClick={() => setEditing(true)}
      >
        {unnamed ? UNNAMED_COLUMN : column.name}
      </button>
    );
  }

  return (
    <input
      className="column-name column-name-input"
      aria-label={unnamed ? "Name of this unnamed column" : `Name of ${column.name}`}
      placeholder="Column name"
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
  source: SourceKind;
  unseen: boolean;
  selected: boolean;
  lifted: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onSelect: (card: Card) => void;
  onWatch: (card: Card, worker: Worker) => void;
}

function CardView({ card, request, worker, source, unseen, selected, lifted, onPointerDown, onSelect, onWatch }: CardViewProps) {
  return (
    <div
      className={`card card-${card.row}${unseen ? " unseen" : ""}${selected ? " selected" : ""}${lifted ? " lifted" : ""}`}
      data-id={card.id}
      onPointerDown={onPointerDown}
    >
      <button className="card-open" onClick={() => onSelect(card)}>
        <CardFace card={card} request={request} />
        {unseen && <span className="sr-only">New update</span>}
      </button>
      {worker && (
        <button
          className={`sailor ${worker.status}`}
          aria-label={sailorLabel(source, worker.status)}
          title={sailorLabel(source, worker.status)}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onWatch(card, worker)}
        >
          <Sailor />
        </button>
      )}
    </div>
  );
}

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
