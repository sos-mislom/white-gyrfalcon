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
  scenarioId: z.literal("boarding_no_ticket"),
  mode: sessionModeSchema.default("training"),
  difficulty: z.number().int().min(1).max(3).default(1),
  seed: z.number().int().min(0).max(2_147_483_647).optional(),
});
export type CreateSessionDto = z.infer<typeof createSessionSchema>;

export const submitActionSchema = z.strictObject({
  idempotencyKey: z.string().uuid(),
  actionId: z.string().trim().min(1).max(80),
  clientTimestamp: z.string().datetime({ offset: true }),
  conduct: z.literal("violent_threat").optional(),
});
export type SubmitActionDto = z.infer<typeof submitActionSchema>;

export const ENGINE_VERSION = "boarding-3" as const;
export const engineVersionSchema = z.enum(["boarding-2", ENGINE_VERSION]);
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
});
export type CheckResultDto = z.infer<typeof checkResultSchema>;

export const submitFreeformActionSchema = z.strictObject({
  sessionId: z.string().uuid(),
  freeformText: z.string().trim().min(1).max(500),
  clientTimestamp: z.string().datetime({ offset: true }),
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
    }),
  ),
  completedActionIds: z.array(z.string()),
  passengerReply: z.string(),
  outcome: z.enum(["active", "resolved", "failed"]),
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
  execution: z.literal("server"),
});
export type FreeformActionResultDto = z.infer<
  typeof freeformActionResultSchema
>;

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("vsm-api"),
  timestamp: z.string().datetime({ offset: true }),
});
export type HealthResponseDto = z.infer<typeof healthResponseSchema>;
