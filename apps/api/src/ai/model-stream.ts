/** Decode only complete JSON string characters from the reply field, never schema keys. */
export function partialReply(json: string): string {
  const start = /"reply"\s*:\s*"/.exec(json);
  if (!start) return "";
  const rest = json.slice(start.index + start[0].length);
  let encoded = "";
  for (let i = 0; i < rest.length; i++) {
    const char = rest[i]!;
    if (char === '"') break;
    if (char === "\\") {
      if (i + 1 >= rest.length) break;
      if (rest[i + 1] === "u") {
        if (i + 5 >= rest.length) break;
        encoded += rest.slice(i, i + 6);
        i += 5;
      } else {
        encoded += rest.slice(i, i + 2);
        i++;
      }
    } else encoded += char;
  }
  try {
    return JSON.parse('"' + encoded + '"') as string;
  } catch {
    return "";
  }
}

export async function readModelStream(
  response: Response,
  onDraft: (text: string) => void,
): Promise<string> {
  if (!response.body) throw new Error("model_stream_missing");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    content = "",
    previous = "",
    stopped = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 65536) throw new Error("model_stream_too_large");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop()!;
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (raw === "[DONE]") continue;
        const chunk = JSON.parse(raw);
        const choice = chunk.choices?.[0];
        if (choice?.finish_reason === "stop") stopped = true;
        if (typeof choice?.delta?.content === "string")
          content += choice.delta.content;
        // Some compatible gateways include the complete message in the final
        // stream event without sending every intermediate content delta.
        if (typeof choice?.message?.content === "string" &&
            choice.message.content.startsWith(content))
          content = choice.message.content;
        if (content.length > 4096) throw new Error("model_reply_too_large");
        const draft = partialReply(content).slice(0, 500);
        if (draft && draft !== previous) {
          previous = draft;
          onDraft(draft);
        }
      }
    }
    if (!stopped) throw new Error("model_stream_truncated");
    return content;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
