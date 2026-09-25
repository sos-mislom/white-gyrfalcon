import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from "@nestjs/swagger";
import {
  createSessionSchema,
  submitActionSchema,
  type CreateSessionDto,
  type SessionStateDto,
  type SubmitActionDto,
} from "@vsm/api-contracts";

import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { SessionsService } from "./sessions.service";

@ApiTags("sessions")
@Controller("sessions")
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post()
  @ApiBody({
    schema: {
      type: "object",
      required: ["scenarioId"],
      properties: {
        scenarioId: { type: "string", example: "boarding_no_ticket" },
        mode: { type: "string", enum: ["training", "assessment"] },
        difficulty: { type: "integer", minimum: 1, maximum: 3 },
        seed: { type: "integer", minimum: 0 },
      },
    },
  })
  @ApiCreatedResponse({ description: "Смена создана" })
  create(
    @Body(new ZodValidationPipe(createSessionSchema)) input: CreateSessionDto,
  ): SessionStateDto {
    return this.sessions.create(input);
  }

  @Get(":sessionId")
  @ApiOkResponse({ description: "Текущее состояние смены" })
  getById(@Param("sessionId") sessionId: string): SessionStateDto {
    return this.sessions.getById(sessionId);
  }

  @Post(":sessionId/actions")
  @ApiBody({
    schema: {
      type: "object",
      required: [
        "idempotencyKey",
        "actionId",
        "kind",
        "durationMinutes",
        "clientTimestamp",
      ],
    },
  })
  @ApiCreatedResponse({ description: "Действие применено к смене" })
  applyAction(
    @Param("sessionId") sessionId: string,
    @Body(new ZodValidationPipe(submitActionSchema)) action: SubmitActionDto,
  ): SessionStateDto {
    return this.sessions.applyAction(sessionId, action);
  }
}
