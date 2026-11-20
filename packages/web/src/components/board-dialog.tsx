import { useEffect, useState } from "preact/hooks";
import { loadBoard, submitName } from "../lib/board-api.js";
import type { BoardSnapshot } from "../lib/standings.js";
import { Modal } from "./modal.js";
import { StandingsView } from "./standings-view.js";

export function BoardDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    setState("loading");
    void loadBoard().then((next) => {
      if (cancel) return;
      setSnapshot(next);
      setState(next ? "ready" : "error");
    });
    return () => {
      cancel = true;
    };
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} label="Today's board">
      <h2 class="panel-title">Today</h2>
      <StandingsView
        snapshot={snapshot}
        state={state}
        onName={async (name) => {
          const result = await submitName(name);
          if (result.snapshot) {
            setSnapshot(result.snapshot);
            setState("ready");
          }
          return result.error;
        }}
      />
    </Modal>
  );
}
