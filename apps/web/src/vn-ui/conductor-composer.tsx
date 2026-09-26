"use client";

import { useEffect, useRef, useState } from "react";
import type { SubmitFreeformActionDto } from "@vsm/api-contracts";
import {
  VoiceSession,
  queuePassengerSpeech,
  stopPassengerReply,
} from "../training/voice-session";

interface ConductorComposerProps {
  busy: boolean;
  active: boolean;
  pending?: SubmitFreeformActionDto;
  error: string | null;
  reply: string;
  draftReply?: string | null;
  replyKey: string;
  disabled?: boolean;
  muted?: boolean;
  voiceGender?: "male" | "female" | "neutral";
  onSubmit: (text: string, interrupted?: boolean) => Promise<boolean>;
}

export function ConductorComposer({
  busy,
  active,
  pending,
  error,
  reply,
  draftReply,
  replyKey,
  disabled,
  muted,
  voiceGender = "neutral",
  onSubmit,
}: ConductorComposerProps) {
  const [text, setText] = useState("");
  const [interrupted, setInterrupted] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const voice = useRef<VoiceSession | null>(null);
  useEffect(
    () => () => {
      void voice.current?.stop();
    },
    [],
  );

  useEffect(() => {
    if (muted) {
      stopPassengerReply();
      return;
    }
    if (pending && !draftReply) {
      stopPassengerReply();
      return;
    }
    if (!reply || !replyKey) return;
    queuePassengerSpeech(draftReply ?? reply, replyKey, !draftReply, voiceGender);
  }, [reply, draftReply, replyKey, pending, muted, voiceGender]);

  useEffect(() => {
    const retry = () => {
      if (!muted && !pending) queuePassengerSpeech(draftReply ?? reply, replyKey, !draftReply, voiceGender);
    };
    window.addEventListener("vsm-voice-ready", retry);
    return () => window.removeEventListener("vsm-voice-ready", retry);
  }, [reply, draftReply, replyKey, pending, muted, voiceGender]);

  const value = pending?.freeformText ?? text;

  const send = async (spoken: string, wasInterrupted: boolean) => {
    if (micActive) {
      setMicActive(false);
      await voice.current?.stop(false);
    }
    if (await onSubmit(spoken, wasInterrupted)) {
      setText((current) => (current === spoken ? "" : current));
    }
  };

  const handleMicToggle = async () => {
    if (micActive) {
      setMicActive(false);
      await voice.current?.stop();
      setVoiceStatus("");
      return;
    }
    setMicActive(true);
    setVoiceStatus("Слушаю вас…");
    stopPassengerReply();
    const session = new VoiceSession(
      (recognizedText, wasInterrupted) => {
        setText(recognizedText);
        setInterrupted(wasInterrupted);
        setVoiceStatus("");
        void send(recognizedText, wasInterrupted);
      },
      setVoiceStatus,
      setText,
    );
    voice.current = session;
    try {
      await session.start();
    } catch (err) {
      setMicActive(false);
      await session.stop();
      setVoiceStatus(
        err instanceof Error ? err.message : "Голосовой ввод недоступен.",
      );
    }
  };

  if (!active) return null;

  return (
    <footer className="vn-conductor-dock" aria-label="Панель ответа проводника">
      <form
        className="vn-composer-bar"
        onSubmit={(event) => {
          event.preventDefault();
          if (!value.trim() || busy || disabled) return;
          void send(value, pending?.interrupted ?? interrupted);
          setInterrupted(false);
        }}
      >
        <div className="vn-input-wrapper">
          <label className="vn-conductor-name" htmlFor="conductor-reply-input">
            ВЫ
          </label>
          <textarea
            id="conductor-reply-input"
            className="vn-reply-textarea"
            rows={2}
            maxLength={500}
            required
            placeholder="Ваша реплика проводника…"
            value={value}
            disabled={busy || Boolean(pending) || disabled}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (value.trim() && !busy && !disabled) {
                  void send(value, pending?.interrupted ?? interrupted);
                  setInterrupted(false);
                }
              }
            }}
          />
        </div>

        <div className="vn-composer-controls">
          <button
            type="button"
            className={`vn-btn-mic${micActive ? " is-listening" : ""}`}
            aria-label={micActive ? "Выключить микрофон" : "Включить микрофон"}
            aria-pressed={micActive}
            disabled={busy || Boolean(pending) || Boolean(disabled)}
            onClick={handleMicToggle}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M6 11a6 6 0 0 0 12 0M12 17v4m-4 0h8" /></svg>
          </button>

          <button
            className="vn-btn-send"
            type="submit"
            aria-label={pending ? "Повторить отправку" : "Отправить реплику"}
            disabled={busy || !value.trim() || disabled}
          >
            <span aria-hidden="true">➤</span>
          </button>
        </div>
      </form>

      {busy && (
        <p className="vn-composer-status vn-status-busy" role="status">
          <span className="vn-spinner" aria-hidden="true" />
          Пассажир отвечает…
        </p>
      )}

      {voiceStatus && (
        <p className="vn-composer-status vn-status-voice" role="status">
          {voiceStatus}
        </p>
      )}

      {error && (
        <div className="vn-composer-error" role="alert">
          <p>{error}</p>
        </div>
      )}
    </footer>
  );
}
