import { expect, it, vi } from "vitest";
import { interruptPlayback, VoiceSession } from "./voice-session";
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
