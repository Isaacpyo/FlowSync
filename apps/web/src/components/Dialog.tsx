import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { IconButton } from './ui';

/**
 * Modal built on the native <dialog> element: focus trapping, Escape to
 * close and the inert background come from the browser.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // A click on the backdrop lands on the <dialog> element itself.
        if (e.target === e.currentTarget) onClose();
      }}
      className={`m-auto w-[calc(100%-2rem)] ${wide ? 'max-w-2xl' : 'max-w-md'} animate-pop rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100`}
    >
      {open && (
        <div className="p-5 sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            <IconButton label="Close" onClick={onClose} className="-mr-2 -mt-1">
              <X className="size-5" aria-hidden />
            </IconButton>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
