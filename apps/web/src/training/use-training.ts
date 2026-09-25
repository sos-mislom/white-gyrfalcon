"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { EMPTY, TrainingStore } from "./training-store";

export function useTraining() {
  const [store] = useState(() => new TrainingStore());
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => EMPTY,
  );
  useEffect(() => {
    void store.initialize();
    const sync = () => {
      void store.sync();
    };
    window.addEventListener("online", sync);
    const interval = window.setInterval(sync, 15000);
    return () => {
      window.removeEventListener("online", sync);
      window.clearInterval(interval);
      store.dispose();
    };
  }, [store]);
  return {
    ...snapshot,
    start: () => store.start(),
    act: (id: string) => store.act(id),
    freeform: (text: string) => store.freeform(text),
    syncNow: store.sync,
  };
}
