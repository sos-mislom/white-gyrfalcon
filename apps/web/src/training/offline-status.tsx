"use client";
import { useEffect, useState } from "react";

export function OfflineStatus() {
  const [message, setMessage] = useState("Подготавливаем загрузку без сети…");
  useEffect(() => {
    let mounted = true;
    async function register() {
      if (process.env.NODE_ENV !== "production") {
        if (mounted) setMessage("Кэш без сети доступен в production-сборке.");
        return;
      }
      try {
        await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("offline_cache_timeout")), 15000),
          ),
        ]);
        if (mounted) setMessage("Приложение готово к загрузке без сети.");
      } catch {
        if (mounted)
          setMessage(
            "Кэш приложения пока не готов. Не закрывайте страницу без сети; сохранённый журнал остаётся на устройстве.",
          );
      }
    }
    void register();
    return () => {
      mounted = false;
    };
  }, []);
  return <p role="status">{message}</p>;
}
