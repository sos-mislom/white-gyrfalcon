"use client";
import { useEffect, useRef, useState } from "react";
import { VoiceSession } from "./voice-session";

export function VoiceInput({
  reply,
  replyKey,
  busy,
  onText,
}: {
  reply?: string;
  replyKey?: string;
  busy: boolean;
  onText: (text: string, interrupted: boolean) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState("");
  const voice = useRef<VoiceSession | null>(null);
  const latest = useRef({ busy, onText });
  useEffect(() => {
    latest.current = { busy, onText };
  }, [busy, onText]);
  useEffect(
    () => () => {
      void voice.current?.stop();
    },
    [],
  );
  useEffect(() => {
    if (!enabled || !reply || !replyKey) return;
    const utterance = new SpeechSynthesisUtterance(reply);
    utterance.lang = "ru-RU";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    return () => window.speechSynthesis.cancel();
  }, [reply, replyKey, enabled]);
  return (
    <div className="vn-voice">
      <button
        type="button"
        className="vn-microphone"
        aria-label={enabled ? "Выключить микрофон" : "Включить микрофон"}
        aria-pressed={enabled}
        onClick={async () => {
          if (enabled) {
            setEnabled(false);
            await voice.current?.stop();
            setStatus("Микрофон выключен.");
            return;
          }
          setEnabled(true);
          setStatus("Подключаем микрофон и локальный VAD…");
          const session = new VoiceSession((text, interrupted) => {
            latest.current.onText(text, interrupted);
            setStatus(
              latest.current.busy
                ? "Фраза распознана. Дождитесь текущего хода и отправьте её."
                : "Фраза распознана и отправлена.",
            );
          }, setStatus);
          voice.current = session;
          try {
            await session.start();
          } catch (error) {
            setEnabled(false);
            await session.stop();
            setStatus(
              error instanceof Error
                ? error.message
                : "Голос недоступен. Используйте текст.",
            );
          }
        }}
      >
        <span aria-hidden="true">🎙️</span>
      </button>
      {status && (
        <p className="vn-voice-status" role="status">
          {status}
        </p>
      )}
    </div>
  );
}
