import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { CloseIcon } from "./icons.js";

/**
 * A dialog on the browser's own <dialog>, so focus is trapped, Escape closes it,
 * and focus goes back to where it came from. Children only render while open.
 */
export function Modal({
  open,
  onClose,
  label,
  variant = "card",
  hideClose = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  variant?: "card" | "sheet" | "wide";
  hideClose?: boolean;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      class={`modal modal-${variant}`}
      aria-label={label}
      onClose={onClose}
      onClick={(event) => {
        // Only a click on the backdrop lands on the dialog element itself.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {open ? (
        <div class="modal-body">
          {hideClose ? null : (
            <button type="button" class="icon-btn modal-close" aria-label="Close" onClick={onClose}>
              <CloseIcon size={18} />
            </button>
          )}
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
