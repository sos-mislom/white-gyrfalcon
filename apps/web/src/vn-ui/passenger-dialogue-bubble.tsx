"use client";

interface PassengerDialogueBubbleProps {
  name?: string;
  text: string;
  isDraft?: boolean;
  isThinking?: boolean;
}

export function PassengerDialogueBubble({
  name = "Сергей",
  text,
  isDraft = false,
  isThinking = false,
}: PassengerDialogueBubbleProps) {
  return (
    <section className="vn-dialogue-bubble" aria-labelledby="vn-speaker-name">
      <div className="vn-bubble-tail" aria-hidden="true" />
      <div className="vn-dialogue-nameplate" id="vn-speaker-name">
        <span className="vn-name-ornament" aria-hidden="true">
          ❖
        </span>
        <span className="vn-name-text">{name}</span>
        <span className="vn-name-ornament" aria-hidden="true">
          ❖
        </span>
      </div>
      <div
        className="vn-dialogue-body"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {isDraft && (
          <div className="vn-draft-indicator" aria-hidden="true">
            <span className="vn-dot" />
            <span className="vn-dot" />
            <span className="vn-dot" />
          </div>
        )}
        <p className="vn-dialogue-text">{text}</p>
        {isThinking && !text && (
          <p className="vn-thinking-placeholder">{name} обдумывает ответ…</p>
        )}
      </div>
    </section>
  );
}
