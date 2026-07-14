'use client';

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-96 rounded-omarchy border border-border bg-surface p-4">
        <h2 className="text-lg font-semibold text-fg">{title}</h2>
        <p className="mt-2 text-sm text-fg-muted">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-omarchy border border-border bg-surface px-3 py-1 text-sm text-fg hover:border-accent">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-omarchy bg-danger px-3 py-1 text-sm text-bg hover:opacity-90"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
