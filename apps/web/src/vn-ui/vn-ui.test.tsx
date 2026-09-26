import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  NarrationBanner,
  PassengerDialogueBubble,
  PassengerStage,
  DebriefModal,
} from "./index";
import { createSession } from "@vsm/simulation-core";

describe("Visual Novel UI Kit", () => {
  it("renders compact pause control with the live clock", () => {
    const html = renderToStaticMarkup(
      <NarrationBanner clock="10:00" onPause={() => undefined} />,
    );
    expect(html).toContain("10:00");
    expect(html).toContain("Пауза");
    expect(html).not.toContain("Платформа №1");
  });

  it("renders PassengerDialogueBubble with nameplate Сергей and without (Пассажир)", () => {
    const html = renderToStaticMarkup(
      <PassengerDialogueBubble
        name="Сергей"
        text="Деньги списались, а билет не пришел."
        isDraft={false}
      />,
    );
    expect(html).toContain("Сергей");
    expect(html).not.toContain("(Пассажир)");
    expect(html).toContain("Деньги списались, а билет не пришел.");
    expect(html).toContain("vn-dialogue-nameplate");
    expect(html).toContain("vn-bubble-tail");
  });

  it("renders the scene background and its own transparent character sprite", () => {
    const html = renderToStaticMarkup(
      <PassengerStage expression="thoughtful" finished={false} avatar="sergey" background="departure" />,
    );
    expect(html).toContain("sergey.webp");
    expect(html).toContain("bg_departure.webp");
    expect(html).toContain("vn-emotion-thoughtful");
    expect(html).not.toContain("passenger_neutral.jpg");
  });

  it("renders a visual result without technical model details", () => {
    const session = createSession({
      scenarioId: "boarding_no_ticket",
      mode: "training",
      difficulty: 1,
    });
    const html = renderToStaticMarkup(
      <DebriefModal
        session={{ ...session, outcome: "resolved" }}
        reply="Да, теперь понятно. Спасибо за помощь."
        characterName="Сергей"
        disabled={false}
        onRestart={async () => {}}
        titleRef={{ current: null }}
      />,
    );
    expect(html).toContain("Смена завершена");
    expect(html).toContain("Сергей");
    expect(html).not.toContain("(Пассажир)");
    expect(html).toContain("Регламент");
    expect(html).toContain("Безопасность");
    expect(html).toContain("vn-radar");
    expect(html).toContain("п. 79");
    expect(html).toContain("publication.pravo.gov.ru");
    expect(html).not.toContain("Технический разбор");
  });

  it("shows the seat scene's own clause and a selectable distant passenger", () => {
    const session = createSession({ scenarioId: "vsm_seat_conflict_01", mode: "training", difficulty: 1 });
    const debrief = renderToStaticMarkup(<DebriefModal session={{ ...session, outcome: "resolved" }} reply="Спасибо." disabled={false} onRestart={async () => {}} titleRef={{ current: null }} />);
    expect(debrief).toContain("п. 92");
    expect(debrief).not.toContain("п. 79");
    const stage = renderToStaticMarkup(<PassengerStage expression="thoughtful" finished={false} avatar="inna" background="carriage" activeActorId="char_inna_seat" actors={[{ id: "char_inna_seat", name: "Инна Михайловна", portrait_key: "inna" }, { id: "char_petr_seat", name: "Пётр Сергеевич", portrait_key: "igor", callout_after_minutes: 0 }]} minute={0} onSelectActor={() => {}} />);
    expect(stage).toContain("Новый разговор. Поговорить: Пётр Сергеевич");
  });
});
