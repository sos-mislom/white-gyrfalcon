import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from "@nestjs/swagger";
import {
  createSessionSchema,
  submitActionSchema,
  sessionStateSchema,
  syncSessionSchema,
  type CreateSessionDto,
  type SessionStateDto,
  type SubmitActionDto,
  type SyncSessionDto,
} from "@vsm/api-contracts";

import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { openApiSchema } from "../common/openapi-schema";
import { SessionsService } from "./sessions.service";

@ApiTags("sessions")
@Controller("sessions")
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post()
  @ApiBody({ schema: openApiSchema(createSessionSchema) })
  @ApiCreatedResponse({
    description: "Смена создана",
    schema: openApiSchema(sessionStateSchema),
  })
  create(
    @Body(new ZodValidationPipe(createSessionSchema)) input: CreateSessionDto,
  ): Promise<SessionStateDto> {
    return this.sessions.create(input);
  }

  @Get(":sessionId")
  @ApiOkResponse({
    description: "Текущее состояние смены",
    schema: openApiSchema(sessionStateSchema),
  })
  getById(
    @Param("sessionId", new ParseUUIDPipe()) sessionId: string,
  ): Promise<SessionStateDto> {
    return this.sessions.getById(sessionId);
  }

  @Post(":sessionId/actions")
  @ApiBody({ schema: openApiSchema(submitActionSchema) })
  @ApiCreatedResponse({
    description: "Действие применено к смене",
    schema: openApiSchema(sessionStateSchema),
  })
  applyAction(
    @Param("sessionId", new ParseUUIDPipe()) sessionId: string,
    @Body(new ZodValidationPipe(submitActionSchema)) action: SubmitActionDto,
  ): Promise<SessionStateDto> {
    return this.sessions.applyAction(sessionId, action);
  }

  @Post(":sessionId/sync")
  @ApiBody({ schema: openApiSchema(syncSessionSchema) })
  @ApiCreatedResponse({
    description: "Журнал пересчитан и сохранён",
    schema: openApiSchema(sessionStateSchema),
  })
  sync(
    @Param("sessionId", new ParseUUIDPipe()) sessionId: string,
    @Body(new ZodValidationPipe(syncSessionSchema)) journal: SyncSessionDto,
  ): Promise<SessionStateDto> {
    return this.sessions.sync(sessionId, journal);
  }
}
