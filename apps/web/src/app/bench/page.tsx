"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { workerMessage } from "../../benchmark/protocol";

export default function BenchmarkPage() {
  const worker = useRef<Worker | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Модель ещё не запускалась.");
  const [report, setReport] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  function stop() {
    worker.current?.terminate();
    worker.current = null;
    if (timeout.current) clearTimeout(timeout.current);
    setBusy(false);
  }
  useEffect(
    () => () => {
      worker.current?.terminate();
      if (timeout.current) clearTimeout(timeout.current);
    },
    [],
  );
  function start() {
    if (worker.current) return;
    setBusy(true);
    setError(null);
    setReport(null);
    setStatus("Запуск отдельного потока…");
    const instance = new Worker(
      new URL("../../benchmark/worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.current = instance;
    timeout.current = setTimeout(() => {
      stop();
      setError(
        "Лимит 120 секунд исчерпан; поток остановлен. Это не успешный benchmark.",
      );
    }, 120_000);
    instance.onerror = () => {
      stop();
      setError("Ошибка потока модели. Проверьте наличие локальных файлов.");
    };
    instance.onmessage = (event: MessageEvent<unknown>) => {
      const parsed = workerMessage.safeParse(event.data);
      if (!parsed.success) {
        stop();
        setError("Некорректный ответ потока модели.");
        return;
      }
      const message = parsed.data;
      if (message.type === "progress") setStatus(message.message);
      else if (message.type === "error") {
        stop();
        setError(message.message);
      } else {
        setReport(
          JSON.stringify(
            {
              ...message.report,
              userAgent: navigator.userAgent,
              hardwareConcurrency: navigator.hardwareConcurrency,
              timestamp: new Date().toISOString(),
            },
            null,
            2,
          ),
        );
        stop();
        setStatus("Прогон закончен. Результат не отправляется на сервер.");
      }
    };
    instance.postMessage("run");
  }
  return (
    <main className="shell">
      <h1>Проверка локальной модели</h1>
      <p>
        RuBERT-tiny q8, CPU/WASM, один поток. Только синтетические фразы; модель
        не выставляет профессиональные баллы и не подключена к игре.
      </p>
      <p>
        Первый запуск скачивает файлы с этого же стенда. Время загрузки включает
        чтение файлов и создание сессии; состояние кэша не сбрасывается
        автоматически.
      </p>
      <button type="button" onClick={start} disabled={busy}>
        Запустить benchmark
      </button>{" "}
      <button
        type="button"
        disabled={!busy}
        onClick={() => {
          stop();
          setStatus("Остановлено пользователем.");
        }}
      >
        Остановить
      </button>
      <p role="status">{status}</p>
      {error && <p role="alert">{error}</p>}
      {report && (
        <>
          <label htmlFor="report">Отчёт JSON — можно скопировать</label>
          <textarea
            id="report"
            readOnly
            rows={24}
            value={report}
            className="benchmark-report"
          />
        </>
      )}
      <p>
        <Link href="/">Вернуться к смене</Link>
      </p>
    </main>
  );
}
