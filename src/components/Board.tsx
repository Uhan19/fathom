import { useState } from "react";
import { ROW_ORDER, type Card, type Column, type RowKey } from "../api";
import { boardMinWidth, cardNote, clampWidth, columnTemplate, groupCards } from "../board";
import { startDrag } from "../drag";
import { ChevronLeft, ChevronRight, Wave } from "./Icons";

interface BoardProps {
  cards: Card[];
  columns: Column[];
  rowNames: Record<RowKey, string>;
  selectedId: string | null;
  onSelect: (card: Card) => void;
  onColumnChange: (project: string, change: { width?: number; collapsed?: boolean }) => void;
}

export function Board({ cards, columns, rowNames, selectedId, onSelect, onColumnChange }: BoardProps) {
  const [liveWidths, setLiveWidths] = useState<Record<string, number>>({});
  const shown = columns.map((c) => (liveWidths[c.project] ? { ...c, width: liveWidths[c.project] } : c));
  const cells = groupCards(cards, shown);
  const template = columnTemplate(shown);

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
    <div className="board-scroll">
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
                <span className="column-name" title={column.name}>
                  {column.name}
                </span>
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
          <section key={row} className={`row row-${row}`} aria-label={rowNames[row]} style={{ gridTemplateColumns: template }}>
            <h2 className="row-name">{rowNames[row]}</h2>
            {shown.map((column) => {
              const here = cells.get(column.project)?.get(row) ?? [];
              return (
                <div key={column.project} className={`cell${column.collapsed ? " cell-collapsed" : ""}`}>
                  {column.collapsed ? (
                    here.length > 0 && <span className="vname">{column.name}</span>
                  ) : (
                    here.map((card) => (
                      <CardView key={card.id} card={card} selected={card.id === selectedId} onSelect={onSelect} />
                    ))
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

function CardView({ card, selected, onSelect }: { card: Card; selected: boolean; onSelect: (card: Card) => void }) {
  const note = cardNote(card);
  return (
    <button className={`card card-${card.row}${selected ? " selected" : ""}`} onClick={() => onSelect(card)}>
      <span className="bar" aria-hidden="true" />
      <span className="card-body">
        <span className="phrase">{card.title}</span>
        {note && <span className="card-note">{note}</span>}
      </span>
    </button>
  );
}
