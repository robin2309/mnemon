import { useEffect, useId, useRef } from 'react';

/**
 * Modal built on the native <dialog>: the browser handles the focus trap, Escape, the
 * inert page behind and giving focus back to the opener on close.
 *
 * The content stays mounted while closed, so a draft survives an accidental close.
 * Put `data-autofocus` on the element that should get the focus when the modal opens.
 */
export default function Modal({ open, onClose, title, children }) {
  const ref = useRef(null);
  const titleId = useId();
  const downOnBackdrop = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.querySelector('[data-autofocus]')?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Close on a click on the backdrop, i.e. on the <dialog> itself outside its panel. Both the
  // press and the release must happen there, so selecting text in a field and releasing the
  // mouse outside does not close the modal.
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onClose={onClose}
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === ref.current;
      }}
      onClick={(e) => {
        if (downOnBackdrop.current && e.target === ref.current) onClose();
        downOnBackdrop.current = false;
      }}
    >
      <div className="modal-panel">
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
