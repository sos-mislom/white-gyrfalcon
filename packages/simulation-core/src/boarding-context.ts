// Reviewed context projection of scenarios.json / vsm_boarding_no_ticket_01.
// Deliberately excludes generated SOP references, scores, promises to hold the train,
// and random professional penalties from that draft.
export function boardingContext(seed: number, difficulty: number) {
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
  return {
    templateId: "vsm_boarding_no_ticket_01" as const,
    role: "Синтетический пассажир в деловой поездке",
    mood: moods[variant % moods.length]!,
    purchaseChannel: channels[Math.floor(variant / 3) % channels.length]!,
    stress: 40 + (variant % 5) * 10,
    patience: 25 + (Math.floor(variant / 7) % 6) * 10,
    initialLoyalty: -10 + (Math.floor(variant / 11) % 3) * 10,
    departureWindowMinutes: 12 - difficulty * 2,
  };
}
