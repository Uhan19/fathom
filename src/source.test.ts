import { describe, expect, it } from "vitest";
import { emptyBoardText, moveCopy, projectTasks } from "./source";

const move = "from Seabed to Surface";

describe("moveCopy", () => {
  it("keeps the Firstmate wording for Firstmate cards", () => {
    expect(moveCopy("firstmate", "asked", move)).toEqual({
      heading: "Asked Firstmate",
      body: "Asked Firstmate to move this from Seabed to Surface. The card stays there until Firstmate's task list agrees.",
    });
    expect(moveCopy("firstmate", "answered", move)?.heading).toBe("Firstmate answered");
  });

  it("names no particular agent for backlog cards", () => {
    expect(moveCopy("fathom", "asked", move)).toEqual({
      heading: "Asked the agent",
      body: "Asked the agent to move this from Seabed to Surface. The card stays there until the agent moves the task or declines.",
    });
    expect(moveCopy("fathom", "sending", move)?.body).toBe("Asking the agent to move this from Seabed to Surface…");
    expect(moveCopy("fathom", "failed", move)?.body).toBe("Could not ask the agent to move this from Seabed to Surface:");
    expect(moveCopy("fathom", "answered", move)?.heading).toBe("The agent answered");
  });

  it("shows nothing once a request is settled", () => {
    for (const status of ["landed", "superseded", "dismissed"] as const) {
      expect(moveCopy("fathom", status, move)).toBeNull();
      expect(moveCopy("firstmate", status, move)).toBeNull();
    }
  });
});

describe("board wording", () => {
  it("says whose tasks a deleted column leaves alone", () => {
    expect(projectTasks("firstmate")).toBe("Firstmate's tasks");
    expect(projectTasks("fathom")).toBe("The backlog tasks");
  });

  it("explains an empty board for each source", () => {
    expect(emptyBoardText("firstmate", "/work/firstmate")).toBe("No tasks yet in /work/firstmate.");
    expect(emptyBoardText("fathom", "")).toBe("No tasks yet. Agents add them through Fathom's MCP server.");
  });
});
