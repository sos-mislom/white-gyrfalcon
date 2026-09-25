import type { MicVAD } from "@ricky0123/vad-web";

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type VoiceWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

export function interruptPlayback(
  synthesis: Pick<SpeechSynthesis, "speaking" | "cancel">,
): boolean {
  const interrupted = synthesis.speaking;
  synthesis.cancel();
  return interrupted;
}

/** Audio stays in the VAD; the separately consented browser ASR may use its vendor's server. */
export class VoiceSession {
  private vad?: MicVAD;
  private recognition?: Recognition;
  private enabled = false;
  private speaking = false;
  private interrupted = false;
  private transcript = "";
  private stream?: MediaStream;
  constructor(
    private onText: (text: string, interrupted: boolean) => void,
    private onStatus: (status: string) => void,
  ) {}

  async start() {
    const browser = window as VoiceWindow;
    const Constructor =
      browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Constructor)
      throw new Error(
        "В этом браузере нет распознавания речи. Используйте текст или Chrome; VAD сам слова не распознаёт.",
      );
    this.enabled = true;
    const { MicVAD } = await import("@ricky0123/vad-web");
    if (!this.enabled) return;
    const recognition = new Constructor();
    this.recognition = recognition;
    recognition.lang = "ru-RU";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      if (!this.speaking) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i]!.isFinal)
          this.transcript += ` ${event.results[i]![0].transcript}`;
      }
    };
    recognition.onend = () => {
      const text = this.transcript.trim();
      this.transcript = "";
      this.speaking = false;
      if (!this.enabled) return;
      if (text) this.onText(text.slice(0, 500), this.interrupted);
      this.interrupted = false;
      try {
        recognition.start();
      } catch {
        this.onStatus("Распознавание остановлено. Выключите и включите голос.");
      }
    };
    recognition.onerror = (event) => {
      if (
        [
          "not-allowed",
          "service-not-allowed",
          "network",
          "audio-capture",
        ].includes(event.error)
      ) {
        this.onStatus(
          `Распознавание недоступно (${event.error}). Текстовый ввод работает.`,
        );
        void this.stop();
      }
    };
    this.vad = await MicVAD.new({
      model: "v5",
      startOnLoad: false,
      redemptionMs: 600,
      baseAssetPath: "/voice-runtime/",
      onnxWASMBasePath: "/voice-runtime/",
      ortConfig: (ort) => {
        ort.env.wasm.numThreads = 1;
      },
      getStream: async () => {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: false,
        });
        this.stream = stream;
        if (!this.enabled) stream.getTracks().forEach((track) => track.stop());
        return stream;
      },
      onSpeechStart: () => {
        this.interrupted =
          interruptPlayback(window.speechSynthesis) || this.interrupted;
        this.speaking = true;
        this.onStatus("Слушаю…");
      },
      onSpeechEnd: () => {
        if (this.enabled) recognition.stop(); // onend flushes the final Russian transcript once.
      },
    });
    if (!this.enabled) {
      const vad = this.vad;
      this.vad = undefined;
      await vad.destroy();
      return;
    }
    await this.vad.start();
    if (!this.enabled) return;
    recognition.start();
    this.onStatus("Голос включён. Завершите фразу паузой 600 мс.");
  }

  async stop() {
    this.enabled = false;
    // Disable owns the same resource as unmount: destroy the ONNX session only once.
    const vad = this.vad;
    this.vad = undefined;
    if (this.recognition) {
      this.recognition.onend = null;
      this.recognition.onresult = null;
      this.recognition.abort();
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    await vad?.destroy();
    window.speechSynthesis.cancel();
  }
}
