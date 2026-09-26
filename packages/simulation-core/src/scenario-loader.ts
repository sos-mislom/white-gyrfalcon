import rawScenarios from "./scenarios.generated.json";
import {
  scenarioDefinitionSchema,
  type ScenarioDefinitionDto,
} from "@vsm/api-contracts";

export interface ScenarioSummaryDto {
  scenarioId: string;
  title: string;
  menuLabel: string;
  type: string;
  characterName?: string;
  location: string;
  urgency: string;
  difficultyDc: number;
}

let cachedScenarios: ScenarioDefinitionDto[] | null = null;

export function loadAllScenarios(): ScenarioDefinitionDto[] {
  if (cachedScenarios) return cachedScenarios;
  cachedScenarios = (rawScenarios as unknown[]).map((raw) => scenarioDefinitionSchema.parse(raw));
  const ids = new Set<string>();
  for (const scene of cachedScenarios) {
    for (const id of [scene.scenario_id, ...scene.aliases]) {
      if (ids.has(id)) throw new Error(`Duplicate scene ID or alias: ${id}`);
      ids.add(id);
    }
    const actions = new Set(scene.incident.branches.map((branch) => branch.action_id));
    if (actions.size !== scene.incident.branches.length) throw new Error(`Duplicate action in ${scene.scenario_id}`);
    const actorIds = new Set([scene.character?.id, ...(scene.interactions?.actors.map(actor => actor.id) ?? [])]);
    for (const branch of scene.incident.branches)
      for (const requirement of branch.requires)
        if (!actions.has(requirement) && !(requirement.startsWith("talk:") && actorIds.has(requirement.slice(5))))
          throw new Error(`Unknown requirement ${requirement} in ${scene.scenario_id}`);
    for (const action of Object.keys(scene.grounding?.required_terms_by_action ?? {}))
      if (!actions.has(action)) throw new Error(`Unknown grounding action ${action} in ${scene.scenario_id}`);
    for (const action of Object.keys(scene.grounding?.forbidden_reply_patterns_by_action ?? {}))
      if (!actions.has(action)) throw new Error(`Unknown grounding action ${action} in ${scene.scenario_id}`);
    for (const pattern of [
      ...(scene.grounding?.forbidden_reply_patterns ?? []),
      ...Object.values(scene.grounding?.forbidden_reply_patterns_by_action ?? {}).flat(),
      ...Object.values(scene.grounding?.required_terms_by_action ?? {}),
    ]) new RegExp(pattern, "iu");
  }
  return cachedScenarios;
}

export function getScenario(id: string): ScenarioDefinitionDto | undefined {
  const scenarios = loadAllScenarios();
  return scenarios.find((s) => s.scenario_id === id || s.aliases.includes(id));
}

export function requireScenario(id: string): ScenarioDefinitionDto {
  const scenario = getScenario(id);
  if (!scenario) {
    throw new Error("unknown_scenario");
  }
  return scenario;
}

export function getFeaturedScenario(): ScenarioDefinitionDto {
  const featured = loadAllScenarios().filter(scene => scene.featured);
  if (featured.length !== 1) throw new Error("Exactly one featured scene is required");
  return featured[0]!;
}

export function listScenarios(): ScenarioSummaryDto[] {
  return loadAllScenarios().map((s) => ({
    scenarioId: s.scenario_id,
    title: s.title,
    menuLabel: s.menu_label ?? s.title,
    type: s.type,
    characterName: s.character?.name,
    location: s.location.zone,
    urgency: s.incident.urgency,
    difficultyDc: s.incident.difficulty_dc,
  }));
}

export function getRandomScenario(
  seed?: number,
  characterOnly = true,
): ScenarioDefinitionDto {
  const scenarios = loadAllScenarios().filter(
    (s) => !characterOnly || s.type === "character",
  );
  if (scenarios.length === 0) {
    throw new Error("No scenarios available");
  }
  const index =
    seed !== undefined
      ? ((Math.imul(seed, 1664525) + 1013904223) >>> 0) % scenarios.length
      : Math.floor(Math.random() * scenarios.length);
  return scenarios[index]!;
}
