# What Fathom does

Run a few coding agents at once and keeping track of them becomes a job of its own.
Fathom takes that job.
It is a desktop board for your agents' tasks, on macOS and Linux, that shows what needs you, what is moving, what is parked and what is done, at a glance.

Free and open source under the MIT License.
For the technical version of this list, written for an agent that will work on Fathom's code, see [Fathom for agents](features-for-agents.md).

## See all of your agents' work at a glance

- **Sorted by what it needs from you.**
  Every task is a card, and five rows read from the top down: Surface needs you, Shallows is in progress, Deep is parked or waiting, Seabed is queued, and Landed is done.
- **One column per project.**
  Columns appear on their own as projects show up, and the header keeps a running count of what sits at the surface and in the shallows.
- **A number for every task.**
  Each card carries a short number such as `#42` that never changes and is never reused, so you and your agents can always point at the same task.
- **Find any task in a keystroke or two.**
  Type a number, a name or a few words of a title into the search field in the header, and jump straight to that card, even when a filter hides it.
- **A sailor on every card with an agent.**
  Its visor glows and blinks while the agent works and dims while it is idle, so you can see who is busy without opening anything.
- **New news lights up.**
  When an agent reports something you have not read yet, the card's bar turns magenta and blinks until you open it, and folded columns and rows light up too.
- **See who you are waiting on.**
  With Firstmate, a card that waits on someone else, such as a code review, a chat reply or an email, shows their names, and pull request reviews update live from GitHub.
- **Show only what matters right now.**
  Show only cards with an agent, or only cards whose agent is working, collapse rows you do not need, or ask Bosun to focus the board on a handful of tasks by number.

## Hand off work and watch it happen

- **Your agent lives beside the board.**
  The chat panel is the real, live terminal of your coding agent: Claude Code, Codex or Firstmate.
  If no agent is running yet, Fathom opens one for you with one click.
- **Workers you can watch.**
  On Fathom's own backlog, ask your agent to start a worker on a task, and a new Claude Code session takes it in its own terminal and keeps the card up to date as it goes.
  With Firstmate, its crewmates show up the same way.
- **Look over any agent's shoulder.**
  Click a sailor to open that agent's live terminal in a large view, or open the card's Agent tab to watch it and message it directly.
- **Shells as tabs.**
  Open a shell as a tab beside the chat, in a project's folder, your home folder or any folder you pick, and it is still there after a restart.
- **Agents keep running when Fathom quits.**
  Terminals live in herdr-core, so closing Fathom never stops your agents, and Fathom finds them again next time.

## Steer by dragging

- **Change the plan by moving cards.**
  Drag a card to another row, and Fathom asks the agent to move the task.
  The card waits in its new place marked "asked" until the agent agrees, and shows the agent's reason if it declines.
- **Arrange cards however you like.**
  Reorder cards within a cell or move them between columns; that is your own layout and changes nothing for the agent.
- **Shape the columns.**
  Add your own columns, rename, reorder, resize and fold them, and delete the ones you no longer need without ever losing a card.

## Everything about a task, in one place

Open a card for its full story.
The task folder, screenshots and progress reports come from Firstmate's records, so those parts show on a Firstmate board.

- **Result first.**
  A headline of what the task produced: the answer, the plan, the pull requests, or a decision waiting on you, with your options laid out to pick from.
- **Screenshots, side by side.**
  Shots the task left behind open in a full-window viewer with before and after, a comparison slider, widths and light and dark variants.
- **Every link, readable.**
  Pull requests, issues, tickets and chat threads are gathered and labelled, and each pull request shows whether it is open, merged or passing its checks.
- **Files, previewed.**
  Reports, notes and images the task mentions open right in Fathom, rendered and readable.
- **A timeline of what happened.**
  The agent's progress reports read newest first, with relative times.
- **Message the agent about this card.**
  Type a note on the card, and it goes to your agent with the card named for context.

## Change Fathom by asking

- **Meet Bosun.**
  Bosun is a helper under the board that you ask in plain words: "show only what is in progress", "hide every project but the web app", "make the chat wider", "focus on 42 and 57".
- **Safe by design.**
  Bosun works through the same code as the window's own controls, and asks before deleting a column or a theme or changing how Fathom connects.
  You watch each change land on the board right above it.
- **It designs themes too.**
  Ask for a new look and Bosun hands the request to a design agent that builds, checks and previews the theme for you.

## Make it yours

- **Themes that restyle everything.**
  Colors, fonts, art, textures, decorative text and even the layout: the chat on the left or right, the board as rows or lanes, the header on top or as a side rail, and card details as a side panel or a pop-over.
- **Themes that cannot break the app.**
  Every theme is checked before Fathom uses it, so every button stays visible, clickable and readable, and one shortcut always brings back the built-in look.
- **Light and dark.**
  Switch with one toggle or shortcut.
- **Fonts and sizes.**
  Pick the chat and board fonts and sizes, including any font installed on your computer.
- **Your shortcuts.**
  Rebind the shortcuts for the chat, light and dark, and Settings.
- **Your names.**
  Rename the rows and columns to whatever words fit your work.

## Works with the agents you already use

- **Any agent can keep its task list here.**
  Fathom is also an MCP server, so Claude Code, Codex or any MCP client can add, update and move tasks on the board.
- **Built for Firstmate.**
  With Firstmate, Fathom shows its task list, its crewmates and their live terminals, and sends your board moves to it as requests.
- **No Firstmate needed.**
  Without it, Fathom keeps its own backlog that your agent fills.
- **Set up by your agent.**
  Paste the [setup sheet](agent-setup.md) into your coding agent, and it installs and connects everything, asking before each step.

## Yours, local and quick

- **Your data stays on your computer.**
  Fathom keeps everything in one small local database, with no account and no cloud.
- **Fathom never edits your agent's files.**
  With Firstmate, it reads the task list through Firstmate's own commands and only ever sends requests.
- **Take it with you.**
  Export everything Fathom stores to JSON and CSV in one click.
- **Opens with your board already there.**
  Fathom paints the last board at once from a cache, then refreshes as your agents work, without polling the task list.
- **Your real board stays private.**
  Theme previews and theme checks always use an invented sample board, so your real tasks never reach a model through theme work.

## Get Fathom

- Download for macOS (Apple Silicon and Intel) or Linux (x86_64, as a Debian package or an AppImage) from the [latest release](https://github.com/Uhan19/fathom/releases/latest), or build from source on macOS or Linux as the [README](../README.md) describes.
- Or let your coding agent do it with the [setup sheet](agent-setup.md).
