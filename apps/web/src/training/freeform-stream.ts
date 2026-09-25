import {
  freeformStreamEventSchema,
  type FreeformActionResultDto,
} from "@vsm/api-contracts";

export class StreamFailure extends Error {
  constructor(readonly status: number) {
    super("freeform_stream_error");
  }
}

export async function readFreeformStream(
  response: Response,
  onDraft: (text: string) => void,
): Promise<FreeformActionResultDto> {
  // Supports the JSON route in tests and older controlled adapters.
  if (!response.headers.get("content-type")?.includes("text/event-stream"))
    return response.json();
  if (!response.body) throw new Error("stream_missing");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) throw new Error("stream_ended_without_commit");
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 256000) throw new Error("stream_event_too_large");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop()!;
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const event = freeformStreamEventSchema.parse(
          JSON.parse(line.slice(5)),
        );
        if (event.type === "draft") onDraft(event.text);
        if (event.type === "error") throw new StreamFailure(event.status);
        if (event.type === "result") return event.result;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
