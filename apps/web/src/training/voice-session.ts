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
interface NativeVoiceBridge {
  canRecognize(): boolean;
  canSpeak(): boolean;
  startListening(): void;
  stopListening(): void;
  speak(text: string): void;
  speakVoice?(text: string, gender: string): void;
  stopSpeech(): void;
}
type VoiceWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
  VsmVoice?: NativeVoiceBridge;
  __vsmNativeSpeech?: (text: string, done: boolean, error: string) => void;
};

export function interruptPlayback(
  synthesis: Pick<SpeechSynthesis, "speaking" | "cancel">,
): boolean {
  const interrupted = synthesis.speaking;
  synthesis.cancel();
  return interrupted;
}

let speechTurn = "";
let spokenTurn = false;

export type VoiceGender = "male" | "female" | "neutral";

function speakPassengerReply(text: string, gender: VoiceGender) {
  const browser = window as VoiceWindow;
  if (browser.VsmVoice) {
    // Android's bridge can appear before its TTS engine finishes loading.
    // Browser synthesis at this point may use a different, male default voice.
    if (!browser.VsmVoice.canSpeak()) return false;
    if (browser.VsmVoice.speakVoice) browser.VsmVoice.speakVoice(text.slice(0, 500), gender);
    else browser.VsmVoice.speak(text.slice(0, 500));
    return true;
  }
  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window))
    return false;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ru-RU";
  const voices = window.speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().startsWith("ru"));
  const pattern = gender === "female"
    ? /female|жен|svetlana|alena|elena|irina|anna|tatiana|tatyana|milena|-dfc-|-ruc-|-rue-/iu
    : gender === "male" ? /(^|[^a-z])male|муж|dmitry|pavel|yuri|alex|maxim|-rud-|-ruf-/iu : null;
  const selected = pattern ? voices.find(v => pattern.test(v.name) && (gender !== "male" || !/female/i.test(v.name))) : voices[0];
  if (selected) utterance.voice = selected;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
  return true;
}

export function stopPassengerReply() {
  speechTurn = "";
  spokenTurn = false;
  (window as VoiceWindow).VsmVoice?.stopSpeech();
  window.speechSynthesis?.cancel();
}

/** Speak exactly one complete first sentence as soon as it is available. */
export function queuePassengerSpeech(text: string, turn: string, final: boolean, gender: VoiceGender = "neutral") {
  if (speechTurn !== turn) {
    stopPassengerReply();
    speechTurn = turn;
  }
  if (spokenTurn) return;
  const sentence = /[.!?](?=\s|$)/u.exec(text);
  if (!sentence && !final) return;
  const end = sentence ? sentence.index + 1 : text.length;
  const first = text.slice(0, Math.min(end, 240)).trim();
  if (first && speakPassengerReply(first, gender)) spokenTurn = true;
}

/** On Android 12+, use the OS on-device recognizer. Browser ASR is explicitly non-offline. */
export class VoiceSession {
  private vad?: MicVAD;
  private recognition?: Recognition;
  private native?: NativeVoiceBridge;
  private enabled = false;
  private speaking = false;
  private interrupted = false;
  private transcript = "";
  private silenceTimer?: ReturnType<typeof setTimeout>;
  private browserSilenceReady = false;
  private stream?: MediaStream;
  constructor(
    private onText: (text: string, interrupted: boolean) => void,
    private onStatus: (status: string) => void,
    private onPartial?: (text: string) => void,
  ) {}

  async start() {
    const browser = window as VoiceWindow;
    stopPassengerReply();
    if (browser.VsmVoice) {
      if (!browser.VsmVoice.canRecognize())
        throw new Error(
          "На устройстве нет локального распознавания речи. Установите русский офлайн-пакет или введите ответ текстом.",
        );
      this.native = browser.VsmVoice;
      this.enabled = true;
      browser.__vsmNativeSpeech = (text, done, error) => {
        if (!this.enabled) return;
        if (error === "speech_started") {
          this.clearSilenceTimer();
          return;
        }
        if (error) {
          if (error === "microphone_permission_denied") {
            this.onStatus("Разрешите доступ к микрофону в настройках Android.");
            void this.stop();
            return;
          }
          this.onStatus("Речь не распознана. Скажите фразу ещё раз.");
        } else if (!done) {
          if (text.trim()) this.clearSilenceTimer();
          this.onPartial?.(`${this.transcript} ${text}`.trim().slice(0, 500));
        } else if (text.trim()) {
          this.transcript = `${this.transcript} ${text.trim()}`.trim().slice(0, 500);
          this.onPartial?.(this.transcript);
          this.scheduleSilenceFlush();
        }
        if (done && this.enabled)
          window.setTimeout(() => {
            if (this.enabled) this.native?.startListening();
          }, 200);
      };
      this.native.startListening();
      this.onStatus("Слушаю. Слова появятся в поле ответа.");
      return;
    }
    const Constructor =
      browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Constructor)
      throw new Error(
        "В этом браузере нет распознавания речи. Введите ответ текстом.",
      );
    this.enabled = true;
    const { MicVAD } = await import("@ricky0123/vad-web");
    if (!this.enabled) return;
    const recognition = new Constructor();
    this.recognition = recognition;
    recognition.lang = "ru-RU";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      if (!this.speaking && !this.browserSilenceReady) return;
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!;
        if (result.isFinal) this.transcript += ` ${result[0].transcript}`;
        else interim += ` ${result[0].transcript}`;
      }
      this.onPartial?.(`${this.transcript} ${interim}`.trim().slice(0, 500));
    };
    recognition.onend = () => {
      if (!this.enabled) return;
      if (this.browserSilenceReady) {
        this.browserSilenceReady = false;
        this.flushTranscript();
      }
      try {
        recognition.start();
      } catch {
        this.onStatus(
          "Распознавание остановлено. Выключите и включите микрофон.",
        );
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
          `Распознавание недоступно (${event.error}). Введите ответ текстом.`,
        );
        void this.stop();
      }
    };
    this.vad = await MicVAD.new({
      model: "v5",
      startOnLoad: false,
      redemptionMs: 2000,
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
        this.browserSilenceReady = false;
        this.interrupted =
          interruptPlayback(window.speechSynthesis) || this.interrupted;
        this.speaking = true;
        this.onStatus("Слушаю…");
      },
      onSpeechEnd: () => {
        this.speaking = false;
        this.browserSilenceReady = true;
        if (this.enabled) recognition.stop();
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
    this.onStatus("Говорите свободно. Отправлю после двух секунд тишины.");
  }

  private clearSilenceTimer() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = undefined;
  }

  private scheduleSilenceFlush() {
    this.clearSilenceTimer();
    this.silenceTimer = setTimeout(() => this.flushTranscript(), 2000);
  }

  private flushTranscript() {
    this.clearSilenceTimer();
    const text = this.transcript.trim();
    this.transcript = "";
    if (this.enabled && text) this.onText(text.slice(0, 500), this.interrupted);
    this.interrupted = false;
  }

  async stop(stopSpeech = true) {
    this.enabled = false;
    this.clearSilenceTimer();
    const browser = window as VoiceWindow;
    if (this.native) {
      this.native.stopListening();
      if (browser.__vsmNativeSpeech) browser.__vsmNativeSpeech = undefined;
      this.native = undefined;
    }
    const vad = this.vad;
    this.vad = undefined;
    if (this.recognition) {
      this.recognition.onend = null;
      this.recognition.onresult = null;
      this.recognition.abort();
      this.recognition = undefined;
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    await vad?.destroy();
    if (stopSpeech) stopPassengerReply();
  }
}
