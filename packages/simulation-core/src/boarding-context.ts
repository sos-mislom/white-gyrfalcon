// Reviewed context projection of scenarios.json / vsm_boarding_no_ticket_01.
// Deliberately excludes generated SOP references, scores, promises to hold the train,
// and random professional penalties from that draft.
export function boardingContext(
  seed: number,
  difficulty: number,
  elapsed = 0,
  markers: { polite?: boolean; empathy?: boolean; rude?: boolean } = {},
) {
  const variant = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const moods = [
    "спешит на встречу",
    "недоволен сбоем покупки",
    "растерян и просит помощи",
  ];
  const channels = [
    "сайт из рекламы",
    "мобильное приложение",
    "письмо с номером заказа",
  ];
  const stress = 40 + (variant % 5) * 10;
  const patience = 25 + (Math.floor(variant / 7) % 6) * 10;
  // Synthetic training persona, not an inference about the actual person's status.
  const persona = ["деловая поездка", "студент", "первый класс"][variant % 3]!;
  const clamp = (n: number) =>
    Math.max(-1, Math.min(1, Math.round(n * 100) / 100));
  const pressure = Math.max(0, Math.min(1, elapsed / (12 - difficulty * 2)));
  const emotional_state = {
    pleasure: clamp(
      -0.2 +
        (markers.polite ? 0.2 : 0) +
        (markers.empathy ? 0.3 : 0) -
        (markers.rude ? 0.6 : 0),
    ),
    arousal: clamp(stress / 100 - 0.6 + pressure + (markers.rude ? 0.2 : 0)),
    dominance: clamp(
      (persona === "первый класс" ? 0.5 : persona === "студент" ? -0.3 : 0.1) +
        (markers.rude ? 0.4 : 0) -
        (markers.polite ? 0.2 : 0),
    ),
  };
  return {
    templateId: "vsm_boarding_no_ticket_01" as const,
    role: "Синтетический пассажир в деловой поездке",
    mood: moods[variant % moods.length]!,
    purchaseChannel: channels[Math.floor(variant / 3) % channels.length]!,
    stress,
    patience,
    persona,
    emotional_state,
    initialLoyalty: -10 + (Math.floor(variant / 11) % 3) * 10,
    departureWindowMinutes: 12 - difficulty * 2,
  };
}
