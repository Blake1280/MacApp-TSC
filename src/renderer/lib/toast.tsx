import React, { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from './utils';

type ToastVariant = 'info' | 'success' | 'warning' | 'error';
type Toast = {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
};

type ToastContextValue = {
  toast: (input: Omit<Toast, 'id'>) => void;
};

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (input: Omit<Toast, 'id'>) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((prev) => [...prev, { ...input, id }]);
      const lifetime = input.variant === 'error' ? 8000 : 5000;
      setTimeout(() => dismiss(id), lifetime);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  // Brand-toned toast surfaces — success/warning use the rose-tinted alert
  // utilities (declared in styles.css) instead of Tailwind's bright green/
  // orange palettes, so toasts read as part of the same composition as the
  // rest of the app. Error stays on the destructive token (genuinely
  // critical — needs to break the palette to grab attention).
  const styles: Record<ToastVariant, { wrapper: string; Icon: typeof CheckCircle2 }> = {
    info: {
      wrapper: 'brand-surface',
      Icon: Info,
    },
    success: {
      wrapper: 'brand-alert-ok',
      Icon: CheckCircle2,
    },
    warning: {
      wrapper: 'brand-alert-warn',
      Icon: AlertTriangle,
    },
    error: {
      wrapper: 'border border-destructive bg-destructive/10 text-destructive rounded-lg',
      Icon: AlertTriangle,
    },
  };
  const variant = toast.variant ?? 'info';
  const { wrapper, Icon } = styles[variant];
  return (
    <div
      className={cn(
        'shadow-lg px-3 py-2.5 flex items-start gap-2 text-sm animate-in slide-in-from-bottom-4',
        wrapper,
      )}
    >
      <Icon className="h-4 w-4 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-medium leading-tight">{toast.title}</div>
        {toast.description && (
          <div className="text-xs opacity-80 mt-0.5">{toast.description}</div>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="opacity-60 hover:opacity-100 transition-opacity"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
