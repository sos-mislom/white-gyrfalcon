import {
  Body,
  BadRequestException,
  Headers,
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
  submitFreeformActionSchema,
  freeformActionResultSchema,
  type SubmitFreeformActionDto,
  type CreateSessionDto,
  type SessionStateDto,
  type SubmitActionDto,
  type SyncSessionDto,
} from "@vsm/api-contracts";

import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { openApiSchema } from "../common/openapi-schema";
import { SessionsService } from "./sessions.service";
import { FreeformService } from "../ai/freeform.service";

@ApiTags("sessions")
@Controller("sessions")
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly freeform: FreeformService,
  ) {}

  @Post(":sessionId/action-freeform")
  @ApiBody({ schema: openApiSchema(submitFreeformActionSchema) })
  @ApiCreatedResponse({ schema: openApiSchema(freeformActionResultSchema) })
  actionFreeform(
    @Param("sessionId", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(submitFreeformActionSchema))
    input: SubmitFreeformActionDto,
    @Headers("if-match") revision?: string,
  ) {
    if (
      id !== input.sessionId ||
      (revision !== undefined && !/^\d{1,2}$/.test(revision))
    )
      throw new BadRequestException({ code: "invalid_freeform_request" });
    return this.freeform.submit(
      input,
      revision === undefined ? undefined : Number(revision),
    );
  }

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
