import { describe, expect, it } from "vitest";
import { screenConduct } from "./conduct-rules";

describe("conduct signals are not legal verdicts", () => {
  it.each([
    "Я тебя убью!",
    "Сейчас изобью вас",
    "Сломаю тебе ноги!",
    "Сука! Я тебя покалечу!",
  ])("detects a direct threat: %s", (text) => {
    const result = screenConduct(text);
    expect(result?.kind).toBe("violent_threat");
    expect(result?.analysis?.markers).toEqual({
      polite: false,
      empathy: false,
      rude: true,
      safetyViolation: true,
    });
    expect(result?.analysis?.explanation).toContain("ст. 119 УК РФ");
    expect(result?.analysis?.explanation).toContain("ст. 20.1 КоАП РФ");
  });
  it.each([
    "Я не буду вас убивать",
    "Я не убью тебя",
    "Я не зарежу вас",
    "Я не застрелю вас",
    "Я не сломаю тебе руку",
    "Вы предлагали взятку",
    "Пассажир сказал: «Я тебя убью»",
    "Нельзя угрожать пассажиру",
    "Убью время в ожидании",
    "Я не беру взятки",
  ])("does not punish negation/report: %s", (text) => {
    expect(screenConduct(text)?.kind).toBe("uncertain");
  });
  it("screens each clause independently after a quotation", () => {
    expect(
      screenConduct("Пассажир сказал: «Я тебя убью». А я тебя зарежу.")?.kind,
    ).toBe("violent_threat");
  });
  it("does not turn profanity or personal payment into a proven violent threat", () => {
    expect(screenConduct("Иди нахуй")?.kind).toBe("profanity");
    expect(screenConduct("Ты охуел, что ли?")?.kind).toBe("profanity");
    expect(screenConduct("Ебать, где мой билет?")?.kind).toBe("profanity");
    expect(screenConduct("Дайте мне 5000 и проходите")?.kind).toBe(
      "improper_payment",
    );
    expect(screenConduct("Оплатите билет в кассе №3")).toBeUndefined();
    expect(screenConduct("Всего доброго, до свидания")).toBeUndefined();
  });
});
