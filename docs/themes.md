# Fathom themes

A Fathom theme restyles the whole window: colors, fonts, art, textures, decorative text and layout.
Every button and control keeps working: Fathom checks each theme before it uses it.
Themes are data, never code.

## Where themes live

Each theme is a folder in `~/.config/fathom/themes/<id>/`, or `$XDG_CONFIG_HOME/fathom/themes/<id>/` on Linux when that is set.
The folder name is the theme's id: lowercase letters, digits and dashes.
Nautical is the built-in theme, with the id `nautical`; it is read-only.
Fathom rewrites this guide as `GUIDE.md` in the themes folder every time it starts.
To share a theme, send its folder.

A theme folder holds:

- `theme.json`, the manifest (below);
- `theme.css`, the styles (below);
- any art, textures and fonts it uses, such as `art/mark.svg`, `art/grain.svg` or `fonts/stamp.woff2`;
- optionally `RECIPE.md` or other notes;
- `.shots/`, written by `fathom theme check` and `fathom theme shot`.

Allowed asset files are css, svg, png, jpg, jpeg, gif, webp, woff, woff2, ttf and otf, up to 4 MB each and 16 MB in total.
Scripts and web pages are refused.

## theme.json

```json
{
  "fathomTheme": 1,
  "name": "Riso",
  "modes": ["light", "dark"],
  "fonts": {
    "body": "\"Iowan Old Style\", Georgia, serif",
    "heading": "\"Iowan Old Style\", Georgia, serif",
    "mono": "\"Courier New\", monospace",
    "terminal": "\"Courier New\", monospace"
  },
  "text": { "brand": "The Paper Atlas", "helper": "Scribe", "projects": "Index →", "surfaceLead": "", "shallowsLead": "" },
  "art": { "brandMark": "art/mark.svg", "sailor": "art/scribe.svg", "sailorActive": "art/scribe-active.svg" },
  "layout": { "chatSide": "right", "board": "rows", "header": "top", "detail": "overlay", "rowLabelWidth": 58 }
}
```

Only `fathomTheme` and `name` are required; everything else falls back to Nautical.
Unknown keys are errors, so a typo never fails silently.

- `fathomTheme` is the contract version, `1`.
- `name` is what the theme picker shows, up to 40 characters.
- `clonedFrom` is the id of the theme this one started from; Duplicate sets it.
- `modes` is `["light", "dark"]`, `["light"]` or `["dark"]`.
  With one mode, the dark mode switch hides and its shortcut does nothing.
- `fonts` are CSS font-family lists.
  They always win over the fonts picked in Settings.
  A Settings font menu shows "Set by the theme" once the theme sets every font it drives: `body` and `heading` for the board menu, `terminal` for the chat menu.
  `body` and `heading` set the board, `mono` the small monospaced labels, and `terminal` the chat and helper terminals.
  A font file in the theme folder needs an `@font-face` rule in `theme.css` with a relative URL.
- `text` replaces decorative text, up to 40 characters each:
  - `brand`: the word mark in the header (Nautical: FATHOM);
  - `helper`: the helper's name everywhere it shows, including its own introduction from its next start (Nautical: Bosun);
  - `projects`: the label over the project heads (Nautical: Projects →);
  - `surfaceLead` and `shallowsLead`: the words before the header counts (Nautical: "At the " and "In the ").

  Button and control labels are never themable.
- `art` replaces the built-in art with files in the theme folder:
  - `brandMark`: the mark beside the brand;
  - `sailor`: the crewmate shown on a card;
  - `sailorActive`: a layer over `sailor` that glows and blinks while the crewmate works, exactly as the built-in visor does.

  Art shows in an `<img>`, so it cannot follow light and dark; pick colors that read in every mode the theme has.
  To recolor the built-in art instead, set its tokens (`--logo-*`, `--sailor-*`).
- `layout` holds the layout options Fathom implements itself (next section).

## Layout options

Layout that changes where something is clicked, dragged or resized goes through these options, never through CSS alone.
Fathom implements each one, including dragging, resizing and keyboard behaviour.

| Option | Values | What changes |
| --- | --- | --- |
| `chatSide` | `right` (default), `left` | The chat panel sits on that side and its handle resizes outward. |
| `board` | `rows` (default), `lanes` | `lanes` turns the stages into columns and the projects into rows. Card drops, project reordering and the collapse arrows follow; projects have no width handle in lanes. |
| `header` | `top` (default), `rail` | `rail` puts the header in a column on the left from 1280 pixels wide, and back on top below that; the column is `--rail-width` wide, 236 pixels unless `theme.css` sets it. A header at the bottom is plain CSS: `[data-part="app"] { flex-direction: column-reverse; }`. |
| `detail` | `side` (default), `overlay` | `overlay` opens a card's detail as a dialog over the board with a scrim: Escape or a click on the scrim closes it, and the board behind cannot be reached. It has no width handle. |
| `rowLabelWidth` | 40 to 320 pixels | The first track, which holds the row names (rows) or the project names (lanes). Nautical: 150. |
| `collapsedWidth` | 32 to 96 pixels | A folded column or lane. Nautical: 44. |
| `laneWidth` | 180 to 480 pixels | Each stage in lanes; only with `board: lanes`. Default 260. |

The options and the sizes are also set as attributes and custom properties on the root element, for the CSS to follow: `data-chat-side`, `data-board`, `data-header`, `data-detail`, `--row-label-width`, `--collapsed-width` and `--lane-width`.
Set the sizes in `theme.json`, not in `theme.css`: Fathom sets these properties itself, so a value in `theme.css` has no effect.

Fathom also sets these custom properties, which a theme may read but never needs to set:

| Property | Set on | Value |
| --- | --- | --- |
| `--board-stages` | `[data-part="board"]` | The number of stages (rows in rows, lanes in lanes), 5. |
| `--board-projects` | `[data-part="board"]` | The number of projects the board shows. |
| `--board-columns` | `[data-part="board"]` | The projects plus the "Add column" head when it shows. |
| `--board-min-width` | `[data-part="board"]` | The board's width in rows: every column, the row labels and the gaps. |
| `--head-template` | `[data-part="board"]` | The grid columns of the project heads in rows. |
| `--row-template` | `[data-part="board"]` | The grid columns of each row in rows. |
| `--lane-template` | `[data-part="board"]` | The grid columns of the board in lanes. |
| `--detail-width` | `[data-part="detail"]` | The card detail's width. |
| `--chat-width` | `[data-part="chat"]` | The chat panel's width. |
| `--helper-height` | `[data-part="bosun"]` | The helper drawer's height. |

## theme.css

Fathom's own styles sit in the cascade layer `app`, and `theme.css` loads unlayered after them.
So any rule in `theme.css` wins over Fathom's without `!important`.

### Selecting parts

Select named parts, never Fathom's class names or ids, which may change in any release:

- `[data-part="card"]` is a kind of element, such as a card, a column head or the header.
- `[data-kind="surface"]` is a variant that does not change, such as a card's or row's stage (`surface`, `shallows`, `deep`, `seabed`, `landed`), a button's style (`header`, `danger`, `dark`) or a tag's kind (`asked`, `failed`, `answered`, `reported`).
- `[data-state~="selected"]` is a state that changes, such as `selected`, `unseen`, `lifted`, `collapsed`, `closed`, `working`, `idle`, `fill`, `targeted`, `active`, `measured` (a card showing its worker's memory), `high` (a memory badge at the Settings threshold or above), and on the Dashboard's memory map `heavy` (a block at that threshold or above), `idle` (a worker past its prompt cache that still holds memory) `roomy` (a block wide enough for larger text) `single` (the Selected card alone, with no idle worker beside it), and on the daily token chart `today` (today's bar, drawn lighter because the day is not over).
- ARIA attributes carry the rest: `[aria-checked="true"]`, `[aria-selected="true"]`, `[aria-expanded="false"]`, `[aria-pressed="true"]` and `:disabled`.
- `[data-control="open-settings"]` is one control, by a stable id (list below).
  Repeated controls share an id; `data-column`, `data-row`, `data-id` and `data-key` on them or their parents tell them apart.
- `:root[data-mode="dark"]` holds dark mode, `:root[data-mode="light"]` light mode.
- Element selectors (`body`, `button`, `svg`, `dialog`), pseudo-classes and pseudo-elements are fine.

The main regions are `app`, `header`, `main`, `board-column`, `board-scroll`, `board`, `column-heads`, `row`, `cell`, `card`, `detail`, `chat-wrap`, `chat`, `bosun` (the helper drawer), `settings-dialog` and `dashboard` (the Dashboard tab, which takes the board's place).

### Tokens

Colors and fonts are custom properties on `:root`.
Duplicate Nautical in Settings to get a `theme.css` that sets every one of them, for light and dark, as a starting point.
The board fonts (`--body-font`, `--heading`) and the structural sizes are not in that file: Fathom sets them from `theme.json` and Settings, so set them there.
The terminal palette is `--term-background`, `--term-foreground`, `--term-cursor`, `--term-cursor-accent`, `--term-selection-background` and the sixteen `--term-<color>` and `--term-bright-<color>` tokens.

### Textures and fonts

Reference files in the theme folder with relative URLs, such as `url("art/grain.svg")` or `url("fonts/stamp.woff2")`, or use `data:` URLs.
Remote URLs, `@import` and script hooks are refused, and Fathom's window cannot load remote files anyway.
Put every rule in `theme.css`.
A texture laid over the whole window needs `pointer-events: none`, or the check finds every control covered.
Fathom turns theme animations off when the system asks for reduced motion.

## The check

`fathom theme check <folder>` renders an invented sample board and Dashboard tab with the theme, in every mode the theme has, at 1600 by 1000 and at the smallest window, 960 by 600.
It compares each view with Nautical on the same sample, control by control:

- every control is present, visible (at least 4 pixels, opacity at least 0.3), reachable (a click at its middle reaches it) and labelled (it has a name, and its text still shows Nautical's label);
- text is never less readable than in Nautical: text Nautical shows at 3:1 or more must keep at least 3:1 against its background, and text Nautical shows below 3:1 must keep at least Nautical's contrast;
- text is painted: a transparent `-webkit-text-fill-color` counts as hidden text unless the text is clipped to a painted background (`background-clip: text` on an element with a background image or color) or outlined with a visible `-webkit-text-stroke` at least 0.5 pixels wide, and such text is judged only by the contrast of its painted letters where the check sees them on screen; text whose letters a clip, mask or filter removes fails the check;
- what is painted counts: the check takes screenshots, so a control whose box shows nothing, as under an opaque layer with `pointer-events: none`, fails as painted over, and text under a layer is measured against what the layer leaves visible;
- only a declared option may remove a control: one mode removes the dark mode switch, lanes remove the project width handles, and the overlay detail removes its width handle.

The check does not catch every way of breaking these rules.
A theme must never replace, cover or overlay a control's label, including with `::before` or `::after` content.
The check does not judge state markers either, so keep them visible yourself.
In particular a card with an unread agent update, `[data-part="card"][data-state~="unseen"]`, must stand out from read cards, as Nautical's blinking `bar` does.

Then it plays the interactions: dragging a card to another stage, at full size and by scrolling at the board's edge in the smallest window, moving a project both ways by its header, widening the chat, narrowing the card panel, closing it with Escape and clicking back into the ticket search after picking a match (or, for the overlay, Escape, the scrim and focus), raising the helper drawer, switching light and dark, and the reset shortcut.
The sample includes long titles, many projects, a folded row, every tag, an error banner and an empty board.

It exits 0 when the theme passes and 1 with its problems, each with the control or part, what failed and a screenshot in `.shots/check/`.
Add `--json` for a JSON result.
A check takes about a minute.

Fathom runs the check whenever a theme in the themes folder changes, and uses a theme only after it passes.
A theme folder that is a symlink to a folder outside the themes folder is checked under its link name; on macOS the watcher does not see edits inside it, so Fathom re-checks such a theme when it starts or when anything else in the themes folder changes.
When a change fails, Fathom keeps showing the theme's last good version, and Settings shows how many problems the check found.
The problems themselves come from `fathom theme check <folder>` or the theme's `.shots/check.json`.

## Shots

`fathom theme shot <folder> [--mode light|dark] [--size desktop|min]` renders the invented sample board with the theme and writes PNG screenshots of the board, a card's detail, Settings, the chat with the helper drawer and the Dashboard tab into `<folder>/.shots/`.
It never shows the real board, so no real task, terminal or name leaves the computer.

The program is `/Applications/Fathom.app/Contents/MacOS/fathom` on macOS and `fathom` on Linux.

## Going back to Nautical

- Shift+Command+0 on macOS or Ctrl+Shift+0 on Linux always goes back to Nautical; no theme can block it or take the keys.
- `fathom --default-theme` starts Fathom with Nautical.
- Ask the helper: "use the Nautical theme".

## Reference

### Part names

```text
agent-choice agent-choices agent-filter agent-filter-icon answer answer-text app app-version
back-link banner bar bar-seg beacon blocked-by board board-column board-empty board-scroll bosun bosun-about
bosun-command bosun-dot bosun-examples bosun-handle bosun-head bosun-hint bosun-rail bosun-screen
bosun-summary bosun-title brand brand-mark brand-mark-gap brand-name breakdown-col button call-bar call-box
call-key call-letter call-opt call-pick call-progress call-q call-radio call-rec call-row
call-row-text card card-body card-ghost card-head card-name card-note card-number card-open card-ref cell chart-axis chart-bar chart-bars chart-frame chart-scale chat
chat-actions chat-body chat-ended chat-head chat-hide chat-rail chat-rail-caret chat-rail-name
chat-status chat-wrap chip chips col-handle column-add column-add-head column-ghost column-head
column-heads column-heads-label column-name column-name-input column-slot column-total composer
composer-box composer-field composer-foot composer-hint composer-recipient composer-to
composer-to-label confirm confirm-foot confirm-move confirm-name consumer-list consumer-name consumer-row consumer-share consumer-value count count-badge count-label
count-lead count-value dash-card dash-head dash-head-end dash-label dash-lead dash-legend dash-muted dash-notice dash-pair dash-title dashboard data-line detail detail-agent detail-head detail-meta detail-note detail-scrim
detail-scroll detail-send detail-tab detail-tab-sailor detail-tabs detail-title detail-title-row
drop-slot error-text fact facts field field-note field-pair file-actions file-glyph file-group
file-list file-main file-meta file-name file-preview file-row file-text film-cell film-label
filter-part filter-strip font-list font-picker font-picker-head font-row font-sample header
header-toggles heavy-note herdr-dot herdr-label hold icon icon-button idle-item idle-meta idle-name idle-tag inline-link key-links launcher
launcher-error launcher-foot launcher-item launcher-list launcher-name launcher-note launcher-path
launcher-section legend-item legend-swatch legend-value link-body link-detail link-glyph link-group link-label link-list link-row
link-sources main map-block map-cell map-label map-name map-note map-size map-tag map-tokens mark markdown matrix-cell matrix-grid matrix-head matrix-state md-image mem-figures mem-map mem-of mem-total memory-badge meta-text
mini-button mix-bar mix-seg moment moment-dot moment-head moment-state moment-text moment-time more-link move
move-actions muted muted-small ok-text opener opener-folder overhead-item overhead-line panel-handle path-link phrase picker
picker-item picker-list picker-meta picker-name picker-reason pill pr-checks pr-line pr-state
pressure-pill preview-head preview-image preview-name preview-text prices-note proc-bar proc-fill proc-name proc-row proc-size prose quiet-note rec-tag recipient-sailor
result result-foot result-points result-prs result-watch result-watch-head result-watch-text
rich-text row row-count row-label row-name row-names row-toggle sailor sailor-art sailor-visor sech
sech-note seg seg-option segmented segmented-option segmented-thumb selected-head selected-meta selected-name selected-size send-field send-note send-row
settings-body settings-dialog settings-foot settings-head settings-legend settings-section
settings-title share-bar share-fill share-list share-name share-row share-value shortcut-empty shortcut-key shortcut-name shortcut-note shortcut-row shortcut-tools
shortcuts shot-axes shot-badge shot-badges shot-cell shot-cell-label shot-expand shot-lead
shot-lead-frame shot-lead-img shot-missing shot-pending shot-scale shot-strip shot-thumb-img spacer
spark split-bar split-seg summary-main summary-top switch switch-knob switch-track tab tab-close
tab-count tab-empty tab-label tab-pane tab-strip terminal-chip terminal-host terminal-scroll
text-input theme-actions ticket-search ticket-search-empty ticket-search-field ticket-search-item
ticket-search-list ticket-search-ref ticket-search-title tile-note tile-value timeline toggle-text
token-tile token-tiles view-switch view-tab viewer viewer-bar viewer-body viewer-count viewer-file
viewer-film viewer-frame viewer-half viewer-img viewer-knob viewer-matrix viewer-scale viewer-side
viewer-side-panel viewer-slider viewer-slider-top viewer-split viewer-stage viewer-task viewer-title
vname wait-avatar wait-box wait-group wait-group-head wait-kind wait-meta wait-more wait-names
wait-need wait-people wait-said wait-tag wait-what wait-who watch watch-backdrop watch-head
watch-sailor watch-status watch-title
```

### Control ids

```text
agent-choice agent-choice-option agent-filter agent-filter-option agent-reattach agent-retry
call-option call-question call-question-open card-message card-message-send card-open card-sailor
chat-change-terminal chat-find-again chat-hide chat-reattach chat-retry chat-show clear-focus
close-detail close-detail-scrim close-viewer close-worker-terminal column-add column-add-input
column-collapse column-delete column-delete-cancel column-delete-confirm column-delete-new-name
column-delete-target column-expand column-rename column-rename-input column-resize composer-message
composer-recipient composer-send content-image content-link content-path detail-tab expand-all
file-back file-open file-open-app file-reveal font-add font-picker-done font-remove font-search
helper-check-again helper-close helper-copy-install helper-open helper-restart helper-retry
helper-start helper-start-again helper-stop idle-more launcher-attach launcher-folder launcher-toggle
link-open map-block move-dismiss move-resend no-match-clear-focus no-match-show-every-card open-agent
open-blocker open-report open-settings picker-terminal resize-card-panel resize-chat resize-helper
row-toggle settings-agent-folder settings-board-font settings-board-font-size settings-cancel
settings-chat-font settings-chat-font-size settings-close settings-export settings-hc-session
settings-hc-socket settings-home settings-linear-workspace settings-memory-badge settings-row-name settings-save
settings-terminal-label settings-theme settings-theme-duplicate settings-themes-folder
settings-ticket-prefixes shell-close-tab shell-reattach shell-retry shortcut-clear shortcut-record
shortcut-reset shot-all shot-expand shot-open shot-phase shot-phase-option shot-state shot-theme
shot-theme-option shot-width shot-width-option show-all-links show-all-projects show-every-card
stop-worker stop-worker-cancel stop-worker-confirm terminal-tab terminal-tab-close ticket-search
ticket-search-result toggle-dark-mode token-mode token-mode-option view-board view-dashboard
viewer-cell viewer-compare viewer-compare-option viewer-phase viewer-phase-option viewer-split
viewer-theme viewer-theme-option viewer-variant viewer-width viewer-width-option viewer-zoom
wait-link worker-reattach worker-retry
```

### Token names

```text
--accent --accent-hover --accent-ink --after-bg --backdrop --badge-bg --badge-hover-bg --badge-ink
--before-bg --board-scale --body-font --brand-ink --card-bg --card-ink --card-ink-2 --card-line
--card-muted --card-shadow --chart-axis --chat-bg --chip-bg --collapsed-width --count-bg --count-ink --ctrl-bg
--ctrl-hover --ctrl-ink --ctrl-line --danger --danger-hover --danger-ink --dash-bg --dash-seg-on --dash-seg-on-ink --drop-bg --drop-line
--drop-target-bg --error-ink --fail-bg --fail-line --fail-mark --field-bg --field-disabled
--field-ink --field-line --field-placeholder --focus-glow --focus-ring --folded-ink --handle-bg
--handle-grip --handle-hover --hazard-gap --hazard-stripe --header-bg --header-blue
--header-ctrl-fill --header-ctrl-hover --header-ctrl-line --header-ink --header-muted --header-rule
--heading --heavy-bg --heavy-ink --heavy-line --hold-bg --hold-line --hover-line --info-line --lamp --lamp-glow --lamp-ink --lane-width
--line --link --link-hover --logo --logo-face --logo-shade --mark-landed --mark-shallows
--mark-surface --mem-bar --mem-bar-track --mem-docker --mem-docker-ink --mem-fathom --mem-fathom-ink --mem-hatch --mem-orchestrator --mem-orchestrator-ink --mem-rest --mem-rest-ink --mem-worker --mem-worker-ink --moment-tone --mono --move-bg --move-line --muted --note-bg --ok-ink --page
--page-ink --panel-bg --panel-ink --panel-ink-2 --pill-deep-bg --pill-ink --pill-landed-bg
--pill-landed-line --pill-seabed-bg --pill-shallows-bg --pill-surface-bg --pr-closed-bg
--pr-closed-ink --pr-draft-bg --pr-draft-ink --pr-merged-bg --pr-merged-ink --pr-open-bg
--pr-open-ink --pressure-critical --pressure-critical-ink --pressure-ok-bg --pressure-ok-ink --quiet-bg --quiet-hover-line --rail-width --refused-glow --row-deep --row-deep-edge
--row-hover --row-ink --row-label-width --row-landed --row-seabed --row-seabed-edge --row-shallows
--row-shallows-edge --row-surface --sailor-badge --sailor-badge-anchor --sailor-brim --sailor-cap
--sailor-cap-shine --sailor-coat --sailor-collar --sailor-ear --sailor-face --sailor-grille
--sailor-grille-slot --sailor-helmet --sailor-visor --sailor-visor-band --sailor-visor-glow
--sailor-visor-shine --seg-on-bg --seg-on-ink --selected-line --shadow --signal --signal-ink
--stage-bg --status-asking --status-asking-glow --status-busy --status-idle --status-problem
--status-ready --strip-bg --strip-field-bg --strip-field-ink --strip-field-line
--strip-field-placeholder --strip-ink --strip-line --strip-muted --tag-asked-bg --tag-asked-ink
--tag-failed-bg --tag-failed-ink --tag-reported-bg --tag-reported-ink --term-background --term-black
--term-blue --term-bright-black --term-bright-blue --term-bright-cyan --term-bright-green
--term-bright-magenta --term-bright-red --term-bright-white --term-bright-yellow --term-cursor
--term-cursor-accent --term-cyan --term-foreground --term-green --term-magenta --term-red
--term-selection-background --term-white --term-yellow --tok-input --tok-output --tok-read --tok-write --tone-active --tone-attention --tone-good
--tone-quiet --tone-trouble --viewer-knob-bg --viewer-knob-ink --viewer-shadow --viewer-split --wait
--wait-bg --wait-ink --wait-line --wait-solid --wait-solid-ink --warn-ink
```
