'use client';

import { createContext, useContext, useRef, useCallback } from 'react';

type UnsavedGuard = () => boolean;

interface UnsavedChangesContextValue {
  register: (guard: UnsavedGuard) => void;
  unregister: () => void;
  confirmNavigation: () => boolean;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextValue>({
  register: () => {},
  unregister: () => {},
  confirmNavigation: () => true,
});

export function UnsavedChangesProvider({ children }: { children: React.ReactNode }) {
  const guardRef = useRef<UnsavedGuard | null>(null);

  const register = useCallback((guard: UnsavedGuard) => {
    guardRef.current = guard;
  }, []);

  const unregister = useCallback(() => {
    guardRef.current = null;
  }, []);

  const confirmNavigation = useCallback(() => {
    if (!guardRef.current) return true;
    const hasUnsaved = guardRef.current();
    if (!hasUnsaved) return true;
    return window.confirm('You have unsaved classification changes. Leave without saving?');
  }, []);

  return (
    <UnsavedChangesContext.Provider value={{ register, unregister, confirmNavigation }}>
      {children}
    </UnsavedChangesContext.Provider>
  );
}

export function useUnsavedChanges() {
  return useContext(UnsavedChangesContext);
}
