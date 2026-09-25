import type { CheckResultDto } from "@vsm/api-contracts";

/** Indexed integer mixing: identical seed + check index gives an identical roll on JS runtimes. */
export function resolveD20(
  seed: number,
  index: number,
  actionId: string,
  dc: number,
  skillModifier: number,
  sopBonus: number,
): CheckResultDto {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b) >>> 0;
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35) >>> 0;
  value = (value ^ (value >>> 16)) >>> 0;
  const roll = 1 + Math.floor((value / 4294967296) * 20);
  const total = roll + skillModifier + sopBonus;
  const outcome =
    roll === 20
      ? "critical_success"
      : roll === 1
        ? "critical_failure"
        : total >= dc
          ? "success"
          : "failure";
  return { actionId, index, roll, dc, skillModifier, sopBonus, total, outcome };
}

export function resolveEmotionalD20(
  seed: number,
  index: number,
  actionId: string,
  dc: number,
  skill: number,
  sop: number,
  advantage: boolean,
  disadvantage: boolean,
): CheckResultDto {
  const first = resolveD20(seed, index * 2, actionId, dc, skill, sop);
  if (advantage === disadvantage)
    return { ...first, index, rolls: [first.roll], mode: "normal" };
  const second = resolveD20(seed, index * 2 + 1, actionId, dc, skill, sop);
  const selected = (
    advantage ? first.roll >= second.roll : first.roll <= second.roll
  )
    ? first
    : second;
  return {
    ...selected,
    index,
    rolls: [first.roll, second.roll],
    mode: advantage ? "advantage" : "disadvantage",
  };
}
