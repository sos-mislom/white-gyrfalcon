import { expect, it, vi } from "vitest";
import { interruptPlayback, VoiceSession, queuePassengerSpeech, speakConversationReply, stopPassengerReply } from "./voice-session";
import { MicVAD } from "@ricky0123/vad-web";
vi.mock("@ricky0123/vad-web", () => ({ MicVAD: { new: vi.fn() } }));
it("barge-in stops playback synchronously and only flags an actual interruption", () => {
  const cancel = vi.fn();
  expect(interruptPlayback({ speaking: true, cancel })).toBe(true);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(interruptPlayback({ speaking: false, cancel })).toBe(false);
});
it("releases ONNX once when disabling voice is followed by unmount", async () => {
  const destroy = vi.fn(async () => {});
  vi.mocked(MicVAD.new).mockResolvedValue({ destroy, start: async () => {} } as unknown as MicVAD);
  vi.stubGlobal("window", { SpeechRecognition: class { start() {} abort() {} }, speechSynthesis: { cancel() {} } });
  try {
    const voice = new VoiceSession(() => {}, () => {});
    await voice.start();
    await voice.stop();
    await voice.stop();
    expect(destroy).toHaveBeenCalledTimes(1);
  } finally { vi.unstubAllGlobals(); }
});
it("queues speech from a streaming reply once and never replays its first sentence", () => {
  const speak = vi.fn();
  vi.stubGlobal("window", {
    VsmVoice: { canSpeak: () => true, speak, stopSpeech: vi.fn() },
    speechSynthesis: { cancel: vi.fn() },
  });
  try {
    queuePassengerSpeech("Спасибо за", "turn-1", false);
    expect(speak).not.toHaveBeenCalled();
    queuePassengerSpeech("Спасибо за помощь. Я успею?", "turn-1", false);
    expect(speak).toHaveBeenCalledWith("Спасибо за помощь.");
    queuePassengerSpeech("Спасибо за помощь. Я успею?", "turn-1", true);
    expect(speak).toHaveBeenLastCalledWith("Спасибо за помощь.");
    expect(speak).toHaveBeenCalledTimes(1);
  } finally { stopPassengerReply(); vi.unstubAllGlobals(); }
});
it("passes the scene's voice gender to Android for the first sentence only", () => {
  const speakVoice = vi.fn();
  vi.stubGlobal("window", {
    VsmVoice: { canSpeak: () => true, speakVoice, stopSpeech: vi.fn() },
    speechSynthesis: { cancel: vi.fn() },
  });
  try {
    queuePassengerSpeech("Помогите. Я тороплюсь.", "female-turn", true, "female");
    expect(speakVoice).toHaveBeenCalledWith("Помогите.", "female");
    expect(speakVoice).toHaveBeenCalledTimes(1);
  } finally { stopPassengerReply(); vi.unstubAllGlobals(); }
});
it("selects a known female Russian voice even when the male voice is listed first", () => {
  const female = { name: "ru-ru-x-ruc-local", lang: "ru-RU" };
  const male = { name: "ru-ru-x-ruf-local", lang: "ru-RU" };
  const speak = vi.fn();
  class Utterance {
    lang = "";
    voice?: typeof female;
    pitch = 1;
    constructor(readonly text: string) {}
  }
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  vi.stubGlobal("window", {
    SpeechSynthesisUtterance: Utterance,
    speechSynthesis: { getVoices: () => [male, female], speak, cancel: vi.fn() },
  });
  try {
    queuePassengerSpeech("Покажите билет.", "female-browser-turn", true, "female");
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak.mock.calls[0]![0].voice).toBe(female);
  } finally { stopPassengerReply(); vi.unstubAllGlobals(); }
});
it("waits for Android TTS instead of speaking with the browser's default voice", () => {
  let ready = false;
  const speakVoice = vi.fn();
  const browserSpeak = vi.fn();
  vi.stubGlobal("window", {
    VsmVoice: { canSpeak: () => ready, speakVoice, stopSpeech: vi.fn() },
    speechSynthesis: { getVoices: () => [], speak: browserSpeak, cancel: vi.fn() },
    SpeechSynthesisUtterance: class {},
  });
  try {
    queuePassengerSpeech("Помогите мне.", "android-ready-turn", true, "female");
    expect(browserSpeak).not.toHaveBeenCalled();
    expect(speakVoice).not.toHaveBeenCalled();
    ready = true;
    queuePassengerSpeech("Помогите мне.", "android-ready-turn", true, "female");
    expect(speakVoice).toHaveBeenCalledWith("Помогите мне.", "female");
  } finally { stopPassengerReply(); vi.unstubAllGlobals(); }
});
it("waits for Android speech completion before the next voice turn and ignores stale completions", async () => {
  const speakVoiceTurn = vi.fn();
  const browser = {
    VsmVoice: { canSpeak: () => true, speakVoiceTurn, stopSpeech: vi.fn() },
    speechSynthesis: { cancel: vi.fn() },
  } as unknown as Window & { __vsmNativeSpeechDone?: (turn: string, success: boolean) => void };
  vi.stubGlobal("window", browser);
  try {
    let completed = false;
    const speech = speakConversationReply("Покажите билет. Я проверю место.", "female");
    void speech.then(() => { completed = true; });
    const turn = speakVoiceTurn.mock.calls[0]![2] as string;
    expect(speakVoiceTurn).toHaveBeenCalledWith("Покажите билет. Я проверю место.", "female", turn);
    browser.__vsmNativeSpeechDone?.("conversation-stale", true);
    await Promise.resolve();
    expect(completed).toBe(false);
    browser.__vsmNativeSpeechDone?.(turn, true);
    await expect(speech).resolves.toBe(true);
    const interrupted = speakConversationReply("Следующая реплика.", "male");
    stopPassengerReply();
    await expect(interrupted).resolves.toBe(false);
  } finally { stopPassengerReply(); vi.unstubAllGlobals(); }
});
it("combines speech across short pauses and sends after two seconds of silence", async () => {
  vi.useFakeTimers();
  const sent = vi.fn();
  const partial = vi.fn();
  const native = {
    canRecognize: () => true,
    startListening: vi.fn(),
    stopListening: vi.fn(),
    stopSpeech: vi.fn(),
  };
  const browser = { VsmVoice: native, speechSynthesis: { cancel: vi.fn() }, setTimeout } as unknown as Window & {
    __vsmNativeSpeech?: (text: string, done: boolean, error: string) => void;
  };
  vi.stubGlobal("window", browser);
  const voice = new VoiceSession(sent, () => {}, partial);
  try {
    await voice.start();
    browser.__vsmNativeSpeech?.("Покажите билет.", true, "");
    await vi.advanceTimersByTimeAsync(1000);
    browser.__vsmNativeSpeech?.("", false, "speech_started");
    await vi.advanceTimersByTimeAsync(500);
    browser.__vsmNativeSpeech?.("second phrase", false, "");
    await vi.advanceTimersByTimeAsync(800);
    expect(sent).not.toHaveBeenCalled();
    browser.__vsmNativeSpeech?.("Я уточню место.", true, "");
    expect(partial).toHaveBeenLastCalledWith("Покажите билет. Я уточню место.");
    await vi.advanceTimersByTimeAsync(1999);
    expect(sent).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveBeenCalledExactlyOnceWith("Покажите билет. Я уточню место.", false);
  } finally {
    await voice.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
it("sends after two seconds despite spurious Android speech-start events", async () => {
  vi.useFakeTimers();
  const sent = vi.fn();
  const native = {
    canRecognize: () => true,
    startListening: vi.fn(),
    stopListening: vi.fn(),
    stopSpeech: vi.fn(),
  };
  const browser = { VsmVoice: native, speechSynthesis: { cancel: vi.fn() }, setTimeout } as unknown as Window & {
    __vsmNativeSpeech?: (text: string, done: boolean, error: string) => void;
  };
  vi.stubGlobal("window", browser);
  const voice = new VoiceSession(sent, () => {});
  try {
    await voice.start();
    browser.__vsmNativeSpeech?.("Please check the ticket", true, "");
    await vi.advanceTimersByTimeAsync(600);
    browser.__vsmNativeSpeech?.("", false, "speech_started");
    await vi.advanceTimersByTimeAsync(800);
    browser.__vsmNativeSpeech?.("", true, "recognition_error_7");
    await vi.advanceTimersByTimeAsync(600);
    expect(sent).toHaveBeenCalledExactlyOnceWith("Please check the ticket", false);
  } finally {
    await voice.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
it("keeps the beginning when Android only finalizes the tail or reports no match", async () => {
  vi.useFakeTimers();
  const sent = vi.fn();
  const partial = vi.fn();
  const status = vi.fn();
  const native = {
    canRecognize: () => true,
    startListening: vi.fn(),
    stopListening: vi.fn(),
    stopSpeech: vi.fn(),
  };
  const browser = { VsmVoice: native, speechSynthesis: { cancel: vi.fn() }, setTimeout } as unknown as Window & {
    __vsmNativeSpeech?: (text: string, done: boolean, error: string) => void;
  };
  vi.stubGlobal("window", browser);
  const voice = new VoiceSession(sent, status, partial);
  try {
    await voice.start();
    expect(status).toHaveBeenLastCalledWith("Подключаю микрофон…");
    browser.__vsmNativeSpeech?.("", false, "recognition_ready");
    expect(status).toHaveBeenLastCalledWith("Говорите…");
    browser.__vsmNativeSpeech?.("Я хотел бы показать билет", false, "");
    browser.__vsmNativeSpeech?.("показать билет", true, "");
    expect(partial).toHaveBeenLastCalledWith("Я хотел бы показать билет");
    await vi.advanceTimersByTimeAsync(500);
    browser.__vsmNativeSpeech?.("у меня место в третьем вагоне", false, "");
    browser.__vsmNativeSpeech?.("вагоне", false, "");
    browser.__vsmNativeSpeech?.("", true, "recognition_error_7");
    expect(partial).toHaveBeenLastCalledWith("Я хотел бы показать билет у меня место в третьем вагоне");
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent).toHaveBeenCalledExactlyOnceWith("Я хотел бы показать билет у меня место в третьем вагоне", false);
  } finally {
    await voice.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
it("sends Android dictation two seconds after speech ends even without a final result", async () => {
  vi.useFakeTimers();
  const sent = vi.fn();
  const native = {
    canRecognize: () => true,
    startListening: vi.fn(),
    stopListening: vi.fn(),
    stopSpeech: vi.fn(),
  };
  const browser = { VsmVoice: native, speechSynthesis: { cancel: vi.fn() }, setTimeout } as unknown as Window & {
    __vsmNativeSpeech?: (text: string, done: boolean, error: string) => void;
  };
  vi.stubGlobal("window", browser);
  const voice = new VoiceSession(sent, () => {});
  try {
    await voice.start();
    browser.__vsmNativeSpeech?.("", false, "speech_started");
    browser.__vsmNativeSpeech?.("Проверьте билет, пожалуйста", false, "");
    browser.__vsmNativeSpeech?.("", false, "speech_ended");
    await vi.advanceTimersByTimeAsync(1999);
    expect(sent).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveBeenCalledExactlyOnceWith("Проверьте билет, пожалуйста", false);
  } finally {
    await voice.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
it("does not restart the two-second timer when Android finalizes the phrase", async () => {
  vi.useFakeTimers();
  const sent = vi.fn();
  const native = {
    canRecognize: () => true,
    startListening: vi.fn(),
    stopListening: vi.fn(),
    stopSpeech: vi.fn(),
  };
  const browser = { VsmVoice: native, speechSynthesis: { cancel: vi.fn() }, setTimeout } as unknown as Window & {
    __vsmNativeSpeech?: (text: string, done: boolean, error: string) => void;
  };
  vi.stubGlobal("window", browser);
  const voice = new VoiceSession(sent, () => {});
  try {
    await voice.start();
    browser.__vsmNativeSpeech?.("Проверьте билет", false, "");
    browser.__vsmNativeSpeech?.("", false, "speech_ended");
    await vi.advanceTimersByTimeAsync(1000);
    browser.__vsmNativeSpeech?.("Проверьте билет", true, "");
    await vi.advanceTimersByTimeAsync(999);
    expect(sent).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveBeenCalledExactlyOnceWith("Проверьте билет", false);
  } finally {
    await voice.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
it("keeps browser dictation open through a short pause between sentences", async () => {
  vi.useFakeTimers();
  const sent = vi.fn();
  let vadOptions: { onSpeechStart: () => void; onSpeechEnd: () => void } | undefined;
  vi.mocked(MicVAD.new).mockImplementation(async (options) => {
    vadOptions = options as typeof vadOptions;
    return { start: async () => {}, destroy: async () => {} } as unknown as MicVAD;
  });
  class Recognition {
    onresult?: (event: unknown) => void;
    onend?: () => void;
    start = vi.fn();
    stop = vi.fn(() => this.onend?.());
    abort = vi.fn();
  }
  const recognition = new Recognition();
  vi.stubGlobal("window", {
    SpeechRecognition: class { constructor() { return recognition; } },
    speechSynthesis: { speaking: false, cancel: vi.fn() },
  });
  const voice = new VoiceSession(sent, () => {});
  try {
    await voice.start();
    vadOptions!.onSpeechStart();
    recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Покажите билет." } }] });
    vadOptions!.onSpeechEnd();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).not.toHaveBeenCalled();
    vadOptions!.onSpeechStart();
    recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Я уточню место." } }] });
    vadOptions!.onSpeechEnd();
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent).toHaveBeenCalledExactlyOnceWith("Покажите билет. Я уточню место.", false);
  } finally {
    await voice.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
it("retains browser interim text when recognition ends without a final result", async () => {
  vi.useFakeTimers();
  const sent = vi.fn();
  let speechStart: (() => void) | undefined;
  let speechEnd: (() => void) | undefined;
  vi.mocked(MicVAD.new).mockImplementation(async (options) => {
    speechStart = () => options?.onSpeechStart?.();
    speechEnd = () => { void options?.onSpeechEnd?.(new Float32Array(0)); };
    return { start: async () => {}, destroy: async () => {} } as unknown as MicVAD;
  });
  class Recognition {
    onresult?: (event: unknown) => void;
    onend?: () => void;
    start() {}
    stop() { this.onend?.(); }
    abort() {}
  }
  const recognition = new Recognition();
  vi.stubGlobal("window", {
    SpeechRecognition: class { constructor() { return recognition; } },
    speechSynthesis: { speaking: false, cancel: vi.fn() },
  });
  const voice = new VoiceSession(sent, () => {});
  try {
    await voice.start();
    speechStart?.();
    recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: "Проверьте мой билет" } }] });
    speechEnd?.();
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent).toHaveBeenCalledExactlyOnceWith("Проверьте мой билет", false);
  } finally {
    await voice.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
