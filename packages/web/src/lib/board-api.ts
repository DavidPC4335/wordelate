import type { BoardSnapshot, BoardStep } from "./standings.js";

export async function joinBoard(): Promise<boolean> {
  try {
    const response = await fetch("/api/session", { method: "POST", credentials: "same-origin" });
    return response.ok;
  } catch {
    return false;
  }
}

async function postJson(path: string, body: unknown, retry: boolean): Promise<Response | null> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
  if (response.status === 401 && retry && (await joinBoard())) {
    return postJson(path, body, false);
  }
  return response;
}

async function readSnapshot(response: Response | null): Promise<BoardSnapshot | null> {
  if (!response || !response.ok) return null;
  try {
    return (await response.json()) as BoardSnapshot;
  } catch {
    return null;
  }
}

export async function submitScore(input: { puzzleId: string; steps: readonly BoardStep[] }): Promise<BoardSnapshot | null> {
  const response = await postJson("/api/score", input, true);
  return readSnapshot(response);
}

export async function submitName(name: string): Promise<{ snapshot: BoardSnapshot | null; error: string | null }> {
  const response = await postJson("/api/name", { name }, true);
  if (!response) return { snapshot: null, error: "The board is unavailable." };
  if (response.ok) {
    try {
      return { snapshot: (await response.json()) as BoardSnapshot, error: null };
    } catch {
      return { snapshot: null, error: "The board is unavailable." };
    }
  }
  try {
    const body = (await response.json()) as { error?: unknown };
    return { snapshot: null, error: typeof body.error === "string" ? body.error : "That name was not saved." };
  } catch {
    return { snapshot: null, error: "That name was not saved." };
  }
}

export async function loadBoard(): Promise<BoardSnapshot | null> {
  try {
    await joinBoard();
    const response = await fetch("/api/leaderboard", { credentials: "same-origin" });
    return readSnapshot(response);
  } catch {
    return null;
  }
}
