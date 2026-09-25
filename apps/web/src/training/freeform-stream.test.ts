import { expect, it } from "vitest";
import { readFreeformStream, StreamFailure } from "./freeform-stream";

const response = (wire: string) => new Response(new ReadableStream({ start(controller) {
  for (const byte of new TextEncoder().encode(wire)) controller.enqueue(new Uint8Array([byte]));
  controller.close();
} }), { headers: { "content-type": "text/event-stream" } });

it("does not count status as passenger text and rejects a truncated reply", async () => {
  const drafts: string[] = [];
  await expect(readFreeformStream(response('data: {"type":"status","stage":"analyzing"}\n\ndata: {"type":"draft","text":"Касса №3"}\n\n'), text => drafts.push(text))).rejects.toThrow();
  expect(drafts).toEqual(["Касса №3"]);
});
it("preserves a confirmed unavailable status so explicit buttons can unlock", async () => {
  await expect(readFreeformStream(response('data: {"type":"error","status":503,"code":"ai_unavailable"}\n\n'), () => {})).rejects.toEqual(new StreamFailure(503));
});
