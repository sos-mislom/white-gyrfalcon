"use client";

interface NarrationBannerProps {
  clock: string;
  onPause: () => void;
  disabled?: boolean;
}

export function NarrationBanner({
  clock,
  onPause,
  disabled,
}: NarrationBannerProps) {
  return (
    <header className="vn-pause-header">
      <button type="button" className="vn-pause-trigger" onClick={onPause} disabled={disabled} aria-label={`Пауза. До отправления ${clock}`}>
        <span className="vn-pause-icon" aria-hidden="true">Ⅱ</span>
        <span className="vn-pause-time">{clock}</span>
      </button>
    </header>
  );
}
