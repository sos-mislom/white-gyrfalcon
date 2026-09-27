"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SubmitFreeformActionDto } from "@vsm/api-contracts";
import {
  VoiceSession,
  queuePassengerSpeech,
  speakConversationReply,
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
  speakerId?: string;
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
  speakerId,
  onSubmit,
}: ConductorComposerProps) {
  const [text, setText] = useState("");
  const [interrupted, setInterrupted] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [micListening, setMicListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const voice = useRef<VoiceSession | null>(null);
  const conversation = useRef(false);
  const generation = useRef(0);
  const phase = useRef<"off" | "listening" | "waiting" | "speaking">("off");
  const latestReplyKey = useRef(replyKey);
  const handledReplyKey = useRef(replyKey);
  const skipAutoReplyKey = useRef("");
  useEffect(() => { latestReplyKey.current = replyKey; }, [replyKey]);

  const endConversation = useCallback((status = "") => {
    conversation.current = false;
    generation.current++;
    phase.current = "off";
    skipAutoReplyKey.current = latestReplyKey.current;
    const current = voice.current;
    voice.current = null;
    void current?.stop(false);
    stopPassengerReply();
    setMicActive(false);
    setMicListening(false);
    setVoiceStatus(status);
  }, []);

  const listen = useCallback(async (turn: number) => {
    if (!conversation.current || generation.current !== turn || voice.current) return;
    phase.current = "listening";
    setMicListening(true);
    setVoiceStatus("Говорите…");
    const session = new VoiceSession(
      (recognizedText, wasInterrupted) => {
        if (!conversation.current || generation.current !== turn || phase.current !== "listening") return;
        phase.current = "waiting";
        setMicListening(false);
        setText(recognizedText);
        setInterrupted(wasInterrupted);
        setVoiceStatus("Пассажир отвечает…");
        voice.current = null;
        void session.stop(false).then(async () => {
          if (!conversation.current || generation.current !== turn) return;
          try {
            await onSubmit(recognizedText, wasInterrupted);
          } catch {
            if (conversation.current && generation.current === turn)
              endConversation("Не удалось отправить. Проверьте связь и повторите реплику.");
            return;
          }
          if (!conversation.current || generation.current !== turn) return;
          setText((current) => current === recognizedText ? "" : current);
          // A rejected turn may produce a spoken clarification instead of a journal action.
          // If neither arrived, leave the transcript visible for manual retry.
          window.setTimeout(() => {
            if (conversation.current && generation.current === turn && phase.current === "waiting" &&
                latestReplyKey.current === handledReplyKey.current) {
              setText(recognizedText);
              endConversation("Не удалось отправить. Проверьте связь и повторите реплику.");
            }
          }, 1500);
        });
      },
      setVoiceStatus,
      setText,
    );
    voice.current = session;
    try {
      await session.start();
      if (!conversation.current || generation.current !== turn) await session.stop(false);
    } catch (err) {
      if (voice.current === session) voice.current = null;
      await session.stop(false);
      if (generation.current === turn)
        endConversation(err instanceof Error ? err.message : "Голосовой ввод недоступен.");
    }
  }, [onSubmit, endConversation]);

  useEffect(
    () => () => {
      conversation.current = false;
      generation.current++;
      void voice.current?.stop(false);
      stopPassengerReply();
    },
    [],
  );

  useEffect(() => {
    if ((!active || disabled || muted) && conversation.current) endConversation();
  }, [active, disabled, muted, endConversation]);

  useEffect(() => {
    const interrupt = () => { if (conversation.current) endConversation(); };
    window.addEventListener("vsm-voice-interrupted", interrupt);
    return () => window.removeEventListener("vsm-voice-interrupted", interrupt);
  }, [endConversation]);

  useEffect(() => {
    if (!conversation.current || phase.current !== "waiting" || pending || busy || draftReply ||
        !reply || replyKey === handledReplyKey.current) return;
    const turn = generation.current;
    handledReplyKey.current = replyKey;
    skipAutoReplyKey.current = replyKey;
    phase.current = "speaking";
    setMicListening(false);
    setVoiceStatus("Пассажир говорит…");
    void speakConversationReply(reply, voiceGender).then((played) => {
      if (!conversation.current || generation.current !== turn) return;
      if (!played) {
        endConversation("Озвучка недоступна. Продолжите текстом.");
        return;
      }
      // Let the speaker's last audio samples leave the microphone path.
      window.setTimeout(() => {
        if (conversation.current && generation.current === turn) void listen(turn);
      }, 450);
    });
  }, [busy, pending, draftReply, reply, replyKey, voiceGender, listen, endConversation]);

  useEffect(() => {
    if (conversation.current) endConversation();
    // Changing the speaker must not send the previous speaker's partial dictation.
  }, [speakerId, endConversation]);

  useEffect(() => {
    if (muted) {
      stopPassengerReply();
      return;
    }
    if (pending && !draftReply) {
      stopPassengerReply();
      return;
    }
    if (!reply || !replyKey || conversation.current || replyKey === skipAutoReplyKey.current) return;
    queuePassengerSpeech(draftReply ?? reply, replyKey, !draftReply, voiceGender);
  }, [reply, draftReply, replyKey, pending, muted, voiceGender]);

  useEffect(() => {
    const retry = () => {
      if (!muted && !pending && !conversation.current && replyKey !== skipAutoReplyKey.current)
        queuePassengerSpeech(draftReply ?? reply, replyKey, !draftReply, voiceGender);
    };
    window.addEventListener("vsm-voice-ready", retry);
    return () => window.removeEventListener("vsm-voice-ready", retry);
  }, [reply, draftReply, replyKey, pending, muted, voiceGender]);

  const value = pending?.freeformText ?? text;

  const send = async (spoken: string, wasInterrupted: boolean) => {
    if (conversation.current) endConversation();
    const currentVoice = voice.current;
    if (currentVoice) {
      voice.current = null;
      setMicActive(false);
      await currentVoice.stop(false);
    }
    if (await onSubmit(spoken, wasInterrupted)) {
      setText((current) => (current === spoken ? "" : current));
    }
  };

  const handleMicToggle = () => {
    if (conversation.current) return endConversation();
    const turn = ++generation.current;
    conversation.current = true;
    phase.current = "listening";
    handledReplyKey.current = replyKey;
    skipAutoReplyKey.current = replyKey;
    setMicActive(true);
    stopPassengerReply();
    void listen(turn);
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
            className={`vn-btn-mic${micActive ? " is-conversation" : ""}${micListening ? " is-listening" : ""}`}
            aria-label={micActive ? "Завершить голосовой разговор" : "Начать голосовой разговор"}
            aria-pressed={micActive}
            disabled={(busy && !micActive) || (Boolean(pending) && !micActive) || Boolean(disabled)}
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

      {busy && !micActive && (
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
