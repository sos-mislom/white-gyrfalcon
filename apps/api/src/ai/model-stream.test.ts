import { expect, it } from "vitest";
import { partialReply, readModelStream } from "./model-stream";

it("extracts only complete JSON escapes, not internal consequence keys", () => {
  expect(partialReply('{"consequenceId":"secret"')).toBe("");
  expect(partialReply('{"reply":"Касса \\u211')).toBe("Касса ");
  expect(partialReply('{"reply":"Касса \\u21163')).toBe("Касса №3");
});
it("streams Russian reply across arbitrary UTF-8 byte boundaries and requires completion", async () => {
  const contents = [
    '{"consequenceId":"fixed", "reply":"',
    "Пойду в кассу №3",
    '"}',
  ];
  const wire = contents
    .map(
      (content) =>
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\r\n\r\n`,
    )
    .join("");
  const finish =
    'data: {"choices":[{"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
  const response = (text: string) =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const byte of new TextEncoder().encode(text))
            controller.enqueue(new Uint8Array([byte]));
          controller.close();
        },
      }),
    );
  const drafts: string[] = [];
  expect(
    JSON.parse(
      await readModelStream(response(wire + finish), (text) =>
        drafts.push(text),
      ),
    ).reply,
  ).toBe("Пойду в кассу №3");
  expect(drafts).toContain("Пойду в кассу №3");
  await expect(readModelStream(response(wire), () => {})).rejects.toThrow(
    "truncated",
  );
});
