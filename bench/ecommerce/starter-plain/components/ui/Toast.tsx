'use client';
import * as RadixToast from '@radix-ui/react-toast';
import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';

type Note = { id: number; title: string; description?: string };
const ToastContext = createContext<(title: string, description?: string) => void>(() => {});

/** Wrap the app once (app/layout.tsx); call useToast() anywhere below it to show a short status message. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const show = useCallback((title: string, description?: string) => {
    setNotes((n) => [...n, { id: Date.now() + Math.random(), title, description }]);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      <RadixToast.Provider swipeDirection="right" duration={4000}>
        {children}
        {notes.map((n) => (
          <RadixToast.Root key={n.id} onOpenChange={(open) => { if (!open) setNotes((all) => all.filter((x) => x.id !== n.id)); }} className="rounded-md border border-slate-200 bg-white p-3 shadow-md">
            <RadixToast.Title className="text-sm font-semibold">{n.title}</RadixToast.Title>
            {n.description ? <RadixToast.Description className="text-sm text-slate-600">{n.description}</RadixToast.Description> : null}
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport className="fixed bottom-4 right-4 flex w-80 flex-col gap-2" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
