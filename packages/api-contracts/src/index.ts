import { z } from "zod";

export const sessionModeSchema = z.enum(["training", "assessment"]);
export type SessionMode = z.infer<typeof sessionModeSchema>;

export const incidentUrgencySchema = z.enum([
  "routine",
  "medium",
  "high",
  "critical",
]);
export type IncidentUrgency = z.infer<typeof incidentUrgencySchema>;

export const incidentStatusSchema = z.enum([
  "pending",
  "active",
  "resolved",
  "failed",
]);
export type IncidentStatus = z.infer<typeof incidentStatusSchema>;

export const actionKindSchema = z.enum([
  "dialogue",
  "quick",
  "standard",
  "complex",
  "movement",
]);
export type ActionKind = z.infer<typeof actionKindSchema>;

export const createSessionSchema = z.strictObject({
  scenarioId: z.string().trim().min(1).max(80),
  mode: sessionModeSchema.default("training"),
  difficulty: z.number().int().min(1).max(3).default(1),
  seed: z.number().int().min(0).max(2_147_483_647).optional(),
});
export type CreateSessionDto = z.infer<typeof createSessionSchema>;

export const communicationSchema = z.strictObject({
  polite: z.boolean(),
  empathy: z.boolean(),
  rude: z.boolean(),
  interrupted: z.boolean().optional(),
});
export const submitActionSchema = z.strictObject({
  idempotencyKey: z.string().uuid(),
  actionId: z.string().trim().min(1).max(80),
  clientTimestamp: z.string().datetime({ offset: true }),
  conduct: z.literal("violent_threat").optional(),
  communication: communicationSchema.optional(),
  utterance: z.string().trim().min(1).max(500).optional(),
  actorReply: z.string().trim().min(1).max(500).optional(),
  actorId: z.string().trim().min(1).max(80).optional(),
});
export type SubmitActionDto = z.infer<typeof submitActionSchema>;

export const ENGINE_VERSION = "scene-5" as const;
export const engineVersionSchema = z.enum([
  "boarding-2",
  "boarding-3",
  ENGINE_VERSION,
]);
export const syncSessionSchema = z
  .strictObject({
    engineVersion: engineVersionSchema,
    setup: createSessionSchema.extend({
      seed: z.number().int().min(0).max(2_147_483_647),
    }),
    commands: z.array(submitActionSchema).max(40),
  })
  .superRefine((value, context) => {
    if (
      new Set(value.commands.map((command) => command.idempotencyKey)).size !==
      value.commands.length
    )
      context.addIssue({
        code: "custom",
        path: ["commands"],
        message: "Command keys must be unique within a journal",
      });
  });
export type SyncSessionDto = z.infer<typeof syncSessionSchema>;

export const incidentStateSchema = z.object({
  id: z.string(),
  locationId: z.string(),
  status: incidentStatusSchema,
  urgency: incidentUrgencySchema,
  phase: z.number().int().nonnegative(),
  timeUntilEscalationMinutes: z.number().nonnegative().nullable(),
});
export type IncidentStateDto = z.infer<typeof incidentStateSchema>;

export const scoreStateSchema = z.object({
  safety: z.number().min(0).max(100),
  service: z.number().min(0).max(100),
  communication: z.number().min(0).max(100),
  procedure: z.number().min(0).max(100),
  timeManagement: z.number().min(0).max(100),
  recovery: z.number().min(0).max(100),
});
export type ScoreStateDto = z.infer<typeof scoreStateSchema>;

export const sessionEventSchema = z.object({
  id: z.string(),
  type: z.enum([
    "session_started",
    "action_applied",
    "incident_escalated",
    "session_finished",
    "check_resolved",
  ]),
  atMinute: z.number().nonnegative(),
  message: z.string(),
});
export type SessionEventDto = z.infer<typeof sessionEventSchema>;

export const checkResultSchema = z.object({
  actionId: z.string(),
  index: z.number().int().nonnegative(),
  roll: z.number().int().min(1).max(20),
  dc: z.number().int(),
  skillModifier: z.number().int(),
  sopBonus: z.number().int(),
  total: z.number().int(),
  outcome: z.enum([
    "critical_success",
    "success",
    "failure",
    "critical_failure",
  ]),
  rolls: z.array(z.number().int().min(1).max(20)).min(1).max(2).optional(),
  mode: z.enum(["normal", "advantage", "disadvantage"]).optional(),
});
export type CheckResultDto = z.infer<typeof checkResultSchema>;

export const submitFreeformActionSchema = z.strictObject({
  sessionId: z.string().uuid(),
  freeformText: z.string().trim().min(1).max(500),
  clientTimestamp: z.string().datetime({ offset: true }),
  interrupted: z.boolean().optional(),
});
export type SubmitFreeformActionDto = z.infer<
  typeof submitFreeformActionSchema
>;

export const nluAnalysisSchema = z.strictObject({
  matchedActionId: z.string().min(1).max(80),
  confidence: z.number().min(0).max(1),
  markers: z.strictObject({
    polite: z.boolean(),
    empathy: z.boolean(),
    rude: z.boolean(),
    safetyViolation: z.boolean(),
  }),
  explanation: z.string().min(1).max(700),
});
export type NluAnalysisDto = z.infer<typeof nluAnalysisSchema>;

export const allowedConsequenceSchema = z.strictObject({
  id: z.string().min(1).max(80),
  description: z.string().min(1).max(700),
});
export type AllowedConsequenceDto = z.infer<typeof allowedConsequenceSchema>;
export const actorResponseSchema = z.strictObject({
  consequenceId: z.string().min(1).max(80),
  reply: z.string().min(1).max(500),
});
export type ActorResponseDto = z.infer<typeof actorResponseSchema>;

export const sessionStateSchema = z.object({
  id: z.string().uuid(),
  engineVersion: engineVersionSchema,
  scenarioId: z.string(),
  mode: sessionModeSchema,
  difficulty: z.number().int().min(1).max(3),
  seed: z.number().int().nonnegative(),
  currentTimeMinutes: z.number().nonnegative(),
  currentLocationId: z.string(),
  currentActorId: z.string().optional(),
  scores: scoreStateSchema,
  passengerLoyalty: z.number().int().min(-100).max(100),
  checks: z.array(checkResultSchema),
  incidents: z.array(incidentStateSchema),
  events: z.array(sessionEventSchema),
  appliedIdempotencyKeys: z.array(z.string().uuid()),
  appliedActions: z.array(
    z.object({
      key: z.string().uuid(),
      actionId: z.string(),
      clientTimestamp: z.string(),
      conduct: z.literal("violent_threat").optional(),
      communication: communicationSchema.optional(),
      utterance: z.string().optional(),
      actorReply: z.string().optional(),
      actorId: z.string().optional(),
    }),
  ),
  completedActionIds: z.array(z.string()),
  dialogueSummary: z.string().max(1000).default(""),
  passengerReply: z.string(),
  outcome: z.enum(["active", "resolved", "failed", "abandoned"]),
  availableActions: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      durationMinutes: z.number().positive(),
    }),
  ),
});
export type SessionStateDto = z.infer<typeof sessionStateSchema>;

export const freeformActionResultSchema = z.strictObject({
  session: sessionStateSchema,
  command: submitActionSchema,
  analysis: nluAnalysisSchema.nullable(),
  allowedConsequences: z.array(allowedConsequenceSchema).min(1).max(4),
  actor: actorResponseSchema,
  actorFallback: z.boolean(),
  source: z.string(),
  execution: z.enum(["server", "local"]),
  responseMode: z.enum(["pool", "generated", "fallback"]).optional(),
});
export type FreeformActionResultDto = z.infer<
  typeof freeformActionResultSchema
>;

export const freeformStreamEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("status"), stage: z.literal("analyzing") }),
  z.strictObject({ type: z.literal("draft"), text: z.string().max(500) }),
  z.strictObject({
    type: z.literal("result"),
    result: freeformActionResultSchema,
  }),
  z.strictObject({
    type: z.literal("error"),
    code: z.string(),
    status: z.number().int(),
  }),
]);
export type FreeformStreamEventDto = z.infer<typeof freeformStreamEventSchema>;

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("vsm-api"),
  timestamp: z.string().datetime({ offset: true }),
});
export type HealthResponseDto = z.infer<typeof healthResponseSchema>;

// Declarative Scenario Contract (JSON / YAML format)
export const scenarioLocationSchema = z.object({
  car_number: z.number().int().nonnegative().optional(),
  class_type: z.string().optional(),
  zone: z.string().min(1),
  speed_kmh: z.number().nonnegative().optional(),
});
export type ScenarioLocationDto = z.infer<typeof scenarioLocationSchema>;

export const scenarioCharacterPsychologySchema = z.object({
  patience: z.number().min(0).max(100),
  aggression: z.number().min(0).max(100),
  stress: z.number().min(0).max(100),
  alcohol: z.number().min(0).max(100).optional(),
});
export type ScenarioCharacterPsychologyDto = z.infer<
  typeof scenarioCharacterPsychologySchema
>;

export const scenarioMoodSeedVariantSchema = z.object({
  tag: z.string().min(1),
  patience_modifier: z.number().int(),
  aggression_modifier: z.number().int(),
});
export type ScenarioMoodSeedVariantDto = z.infer<
  typeof scenarioMoodSeedVariantSchema
>;

export const scenarioVoiceProfileSchema = z.object({
  gender: z.enum(["male", "female", "neutral"]).optional(),
  pitch: z.string().optional(),
  speed: z.number().optional(),
  tone: z.string().optional(),
  tts_voice_hint: z.string().optional(),
});
export type ScenarioVoiceProfileDto = z.infer<
  typeof scenarioVoiceProfileSchema
>;

export const scenarioCharacterSchema = z.object({
  id: z.string().min(1),
  portrait_key: z.enum(["sergey", "elena", "igor", "tamara", "artem", "mikhail", "inna", "maria_child", "dummy"]).default("dummy"),
  name: z.string().min(1),
  role: z.string().min(1),
  archetype: z.string().min(1),
  psychological_state: scenarioCharacterPsychologySchema,
  hidden_biases: z.array(z.string()).default([]),
  mood_seed_variants: z.array(scenarioMoodSeedVariantSchema).optional(),
  voice_profile: scenarioVoiceProfileSchema.optional(),
  dialogue_vector: z.string().optional(),
});
export type ScenarioCharacterDto = z.infer<typeof scenarioCharacterSchema>;

export const scenarioOutcomeStatusSchema = z.enum([
  "active",
  "in_progress",
  "resolved",
  "escalating",
  "failed",
]);
export type ScenarioOutcomeStatus = z.infer<typeof scenarioOutcomeStatusSchema>;

export const scenarioOutcomeSchema = z.object({
  reaction_vector: z.string().min(1),
  nps_delta: z.number().optional(),
  safety_delta: z.number().optional(),
  procedure_delta: z.number().optional(),
  service_delta: z.number().optional(),
  status: scenarioOutcomeStatusSchema,
  note: z.string().optional(),
});
export type ScenarioOutcomeDto = z.infer<typeof scenarioOutcomeSchema>;

export const scenarioBranchSchema = z.object({
  action_id: z.string().min(1),
  intent_label: z.string().min(1),
  example_phrases: z.array(z.string()).min(1),
  match_patterns: z.array(z.string().min(1)).default([]),
  sop_bonus: z.number().int().default(0),
  is_violation: z.boolean().optional(),
  duration_minutes: z.number().positive().default(1),
  requires: z.array(z.string()).default([]),
  missing_requirement: z.object({
    reaction_vector: z.string().min(1),
    status: scenarioOutcomeStatusSchema.default("escalating"),
    procedure_delta: z.number().default(-10),
  }).optional(),
  outcomes: z.object({
    critical_success: scenarioOutcomeSchema.nullable().optional(),
    success: scenarioOutcomeSchema.nullable().optional(),
    failure: scenarioOutcomeSchema.nullable().optional(),
    critical_failure: scenarioOutcomeSchema.nullable().optional(),
  }),
});
export type ScenarioBranchDto = z.infer<typeof scenarioBranchSchema>;

export const scenarioDefinitionSchema = z.object({
  scenario_id: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  featured: z.boolean().default(false),
  menu_label: z.string().min(1).optional(),
  type: z.enum([
    "character",
    "environmental",
    "environment",
    "environmental_emergency",
    "mixed",
    "train_system",
  ]).default("character"),
  title: z.string().min(1),
  interactions: z.object({
    actors: z.array(scenarioCharacterSchema.extend({
      initial_speech: z.string().min(1),
      zone: z.string().min(1),
      callout_after_minutes: z.number().nonnegative().optional(),
    })).min(1),
  }).optional(),
  legal_basis: z.array(z.object({
    act: z.string().min(1),
    clause: z.string().min(1),
    url: z.string().url(),
    application: z.string().min(1),
  })).min(1),
  visual: z.object({ background: z.enum(["departure", "carriage"]) }).default({ background: "carriage" }),
  grounding: z.object({
    forbidden_reply_patterns: z.array(z.string()).default([]),
    forbidden_reply_patterns_by_action: z.record(z.string(), z.array(z.string())).default({}),
    required_terms_by_action: z.record(z.string(), z.string()).default({}),
  }).optional(),
  location: scenarioLocationSchema,
  character: scenarioCharacterSchema.nullable().optional(),
  incident: z.object({
    category: z.string().min(1),
    urgency: z.enum(["routine", "medium", "high", "critical"]).default("medium"),
    difficulty_dc: z.number().int().min(5).max(25).default(12),
    initial_speech: z.string().optional(),
    context_description: z.string().optional(),
    sop_reference: z.string().min(1),
    required_tools: z.array(z.string()).optional(),
    branches: z.array(scenarioBranchSchema).min(1),
    escalation: z.object({
      warning_minutes: z.number().positive(),
      deadline_minutes: z.number().positive(),
      warning_vector: z.string().min(1),
      failure_vector: z.string().min(1),
      wrong_action_vector: z.string().min(1),
      idle_vector: z.string().min(1),
      conversation_vector: z.string().min(1),
      warning_time_penalty: z.number().nonnegative().default(10),
      failure_time_penalty: z.number().nonnegative().default(30),
      wrong_action_penalty: z.number().nonnegative().default(10),
      idle_time_penalty: z.number().nonnegative().default(10),
    }),
  }),
});
export type ScenarioDefinitionDto = z.infer<typeof scenarioDefinitionSchema>;
