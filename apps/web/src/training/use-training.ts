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
    const previousController = typeof navigator !== "undefined" && "serviceWorker" in navigator
      ? navigator.serviceWorker.controller
      : null;
    const onControllerChange = () => {
      if (previousController && navigator.serviceWorker.controller !== previousController)
        window.location.reload();
    };
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      // Registration is independent of the now-hidden diagnostic panel.
      navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
      void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((registration) => registration.update()).catch(() => undefined);
    }
    const sync = () => {
      void store.sync();
    };
    window.addEventListener("online", sync);
    const interval = window.setInterval(sync, 15000);
    return () => {
      window.removeEventListener("online", sync);
      if ("serviceWorker" in navigator)
        navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      window.clearInterval(interval);
      store.dispose();
    };
  }, [store]);
  return {
    ...snapshot,
    start: (scenarioId?: string) => store.start(scenarioId),
    exitToMenu: () => store.exitToMenu(),
    act: (id: string) => store.act(id),
    freeform: async (text: string, interrupted = false) => {
      const before = store.getSnapshot().record?.lastFreeform?.command.idempotencyKey;
      await store.freeform(text, interrupted);
      return store.getSnapshot().record?.lastFreeform?.command.idempotencyKey !== before;
    },
    syncNow: store.sync,
  };
}
