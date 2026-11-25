import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { listPlace, matchTickets, searchKey, type Ticket } from "../ticketSearch";
import { states } from "../parts";

interface TicketSearchProps {
  tickets: Ticket[];
  onOpen: (id: string) => void;
}

export function TicketSearch({ tickets, onOpen }: TicketSearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState(0);
  const [place, setPlace] = useState<CSSProperties>({});
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();
  const matches = matchTickets(tickets, query);
  const active = Math.max(0, Math.min(chosen, matches.length - 1));
  const shown = open && query.trim() !== "";
  const optionId = (index: number) => `${listId}-${index}`;

  useLayoutEffect(() => {
    if (!shown) return;
    const measure = () => {
      const box = field.current?.getBoundingClientRect();
      if (box) setPlace(listPlace(box, { width: window.innerWidth, height: window.innerHeight }));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [shown]);

  useEffect(() => {
    if (shown) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [shown, active]);

  const pick = (ticket: Ticket) => {
    setOpen(false);
    onOpen(ticket.card.id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (!shown) {
      if (e.key === "ArrowDown" && query.trim()) setOpen(true);
      return;
    }
    const step = searchKey(e.key, active, matches.length);
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    if (step.type === "move") setChosen(step.active);
    else if (step.type === "pick") pick(matches[step.index]);
    else setOpen(false);
  };

  return (
    <div className="ticket-search" data-part="ticket-search" data-state={states({ open: shown })}>
      <input
        ref={field}
        className="ticket-search-field"
        data-part="ticket-search-field"
        data-control="ticket-search"
        type="text"
        role="combobox"
        aria-label="Search tickets by id or title"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown && matches.length > 0 ? optionId(active) : undefined}
        placeholder="Search tickets"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setChosen(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {shown && (
        <ul className="ticket-search-list" data-part="ticket-search-list" id={listId} role="listbox" aria-label="Matching tickets" ref={list} style={place} onMouseDown={(e) => e.preventDefault()}>
          {matches.length === 0 ? (
            <li className="ticket-search-empty" data-part="ticket-search-empty" role="presentation">
              No matching tickets
            </li>
          ) : (
            matches.map((ticket, index) => (
              <li
                key={ticket.card.id}
                id={optionId(index)}
                className="ticket-search-item"
                data-part="ticket-search-item"
                data-control="ticket-search-result"
                data-state={states({ active: index === active })}
                data-id={ticket.card.id}
                data-index={index}
                role="option"
                aria-selected={index === active}
                title={`${ticket.ref} ${ticket.card.title}`}
                onPointerEnter={() => setChosen(index)}
                onClick={() => pick(ticket)}
              >
                <span className="ticket-search-ref" data-part="ticket-search-ref">{ticket.ref}</span>
                <span className="ticket-search-title" data-part="ticket-search-title">{ticket.card.title}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
