import {
  Body,
  BadRequestException,
  Headers,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  HttpException,
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
  type SyncSessionDto,
  submitFreeformActionSchema,
  freeformActionResultSchema,
  type SubmitFreeformActionDto,
  type CreateSessionDto,
  type SessionStateDto,
  type SubmitActionDto,
} from "@vsm/api-contracts";
import type { FastifyReply } from "fastify";
import type { FreeformStreamEventDto } from "@vsm/api-contracts";

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

  @Post(":sessionId/action-freeform/stream")
  @ApiBody({ schema: openApiSchema(submitFreeformActionSchema) })
  @ApiOkResponse({
    description:
      "text/event-stream: status, draft (unverified), result (committed), error",
  })
  async streamFreeform(
    @Param("sessionId", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(submitFreeformActionSchema))
    input: SubmitFreeformActionDto,
    @Res() reply: FastifyReply,
    @Headers("if-match") revision?: string,
  ) {
    if (
      id !== input.sessionId ||
      (revision !== undefined && !/^\d{1,2}$/.test(revision))
    )
      throw new BadRequestException({ code: "invalid_freeform_request" });
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    });
    let connected = true;
    const send = (event: FreeformStreamEventDto) => {
      if (connected && !reply.raw.destroyed)
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const heartbeat = setInterval(() => {
      if (connected) reply.raw.write(": keepalive\n\n");
    }, 10000);
    reply.raw.on("close", () => {
      connected = false;
      clearInterval(heartbeat);
    });
    send({ type: "status", stage: "analyzing" });
    try {
      // A disconnected viewer must not cause a second roll on retry. Receipt still commits.
      const result = await this.freeform.submit(
        input,
        revision === undefined ? undefined : Number(revision),
        (text) => send({ type: "draft", text }),
      );
      send({ type: "result", result });
    } catch (error) {
      // An unknown storage failure may have committed: retain the client's retry receipt.
      const status = error instanceof HttpException ? error.getStatus() : 500;
      send({
        type: "error",
        status,
        code:
          status === 422
            ? "ai_intent_uncertain"
            : status === 409
              ? "session_changed"
              : "ai_unavailable",
      });
    } finally {
      clearInterval(heartbeat);
      if (connected) reply.raw.end();
    }
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
    @Headers("x-vsm-device-id") deviceId?: string,
  ): Promise<SessionStateDto> {
    if (deviceId !== undefined && !/^[a-f0-9]{64}$/.test(deviceId))
      throw new BadRequestException({ code: "invalid_device_id" });
    return this.sessions.sync(sessionId, journal, deviceId);
  }
}
