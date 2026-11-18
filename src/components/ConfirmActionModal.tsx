import { AlertTriangle, Loader2, X } from 'lucide-react';

interface ConfirmActionModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  itemsPreview?: string[];
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  busy?: boolean;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}

export function ConfirmActionModal({
  isOpen,
  title,
  description,
  itemsPreview = [],
  confirmLabel,
  tone = 'primary',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmActionModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-action-title"
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <AlertTriangle
              className={`w-4 h-4 shrink-0 ${
                tone === 'danger' ? 'text-red-700' : 'text-blue-700'
              }`}
            />
            <h2 id="confirm-action-title" className="text-base font-semibold text-slate-900">
              {title}
            </h2>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            aria-label="Close confirmation dialog"
            className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-slate-700 leading-relaxed">{description}</p>

          {itemsPreview.length > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 max-h-56 overflow-y-auto space-y-1.5">
              {itemsPreview.map((item, idx) => (
                <p key={idx} className="text-xs text-slate-700 leading-snug">
                  {idx + 1}. {item}
                </p>
              ))}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white rounded-lg transition-colors whitespace-nowrap disabled:opacity-50 ${
                tone === 'danger'
                  ? 'bg-red-700 hover:bg-red-800'
                  : 'bg-blue-700 hover:bg-blue-800'
              }`}
            >
              {busy ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Applying...
                </>
              ) : (
                confirmLabel
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
