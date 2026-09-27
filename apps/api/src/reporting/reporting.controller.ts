import { BadRequestException, Body, Controller, Get, Headers, NotFoundException, Param, Put, Res, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ApiBody, ApiHeader, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { readFileSync } from "node:fs";
import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { openApiSchema } from "../common/openapi-schema";
import { appConfigSchema, ReportingService, type AppConfig } from "./reporting.service";

const bindingSchema = z.strictObject({ deviceId: z.string().regex(/^[a-f0-9]{64}$/) });
type Binding = z.infer<typeof bindingSchema>;

function requireIntegrationKey(candidate?: string): void {
  let expected = process.env.INTEGRATION_API_KEY;
  if (process.env.INTEGRATION_API_KEY_FILE) {
    try { expected = readFileSync(process.env.INTEGRATION_API_KEY_FILE, "utf8").trim(); }
    catch { throw new ServiceUnavailableException({ code: "integration_key_unavailable" }); }
  }
  if (!expected || expected.length < 32) throw new ServiceUnavailableException({ code: "integration_not_configured" });
  const a = createHash("sha256").update(candidate ?? "").digest();
  const b = createHash("sha256").update(expected).digest();
  if (!candidate || !timingSafeEqual(a, b)) throw new UnauthorizedException({ code: "integration_unauthorized" });
}

function externalId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new BadRequestException({ code: "invalid_external_id" });
  return value;
}

function csvCell(value: string | number | boolean): string {
  const safe = String(value).replace(/^[=+@\-\t\r]/, "'$&");
  return `"${safe.replace(/"/g, '""')}"`;
}

@ApiTags("configuration")
@Controller("config")
export class AppConfigController {
  constructor(private readonly reporting: ReportingService) {}

  @Get()
  @ApiOkResponse({ schema: openApiSchema(appConfigSchema) })
  get() { return this.reporting.config(); }

  @Put()
  @ApiHeader({ name: "x-vsm-integration-key", required: true })
  @ApiBody({ schema: openApiSchema(appConfigSchema) })
  @ApiOkResponse({ schema: openApiSchema(appConfigSchema) })
  put(@Headers("x-vsm-integration-key") key: string | undefined,
    @Body(new ZodValidationPipe(appConfigSchema)) config: AppConfig) {
    requireIntegrationKey(key);
    return this.reporting.saveConfig(config);
  }
}

@ApiTags("leaderboard")
@Controller("leaderboard")
export class LeaderboardController {
  constructor(private readonly reporting: ReportingService) {}

  @Get()
  get() { return this.reporting.leaderboard(); }

  @Get("export.csv")
  async csv(@Res() reply: FastifyReply) {
    const { entries } = await this.reporting.leaderboard();
    const rows = ["rank,player,completed_scenes,average_score",
      ...entries.map(item => [item.rank, item.player, item.completedScenes, item.averageScore].map(csvCell).join(","))];
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", "attachment; filename=leaderboard.csv");
    return reply.send("\uFEFF" + rows.join("\r\n") + "\r\n");
  }
}

@ApiTags("rzd-integration")
@ApiHeader({ name: "x-vsm-integration-key", required: true })
@Controller("integrations/rzd/users")
export class RzdIntegrationController {
  constructor(private readonly reporting: ReportingService) {}

  @Put(":externalId/device")
  @ApiBody({ schema: openApiSchema(bindingSchema) })
  async bind(@Param("externalId") id: string,
    @Headers("x-vsm-integration-key") key: string | undefined,
    @Body(new ZodValidationPipe(bindingSchema)) body: Binding) {
    requireIntegrationKey(key);
    const saved = await this.reporting.bind(externalId(id), body.deviceId);
    if (!saved) throw new BadRequestException({ code: "external_user_already_bound" });
    return { externalUserId: id, bound: true };
  }

  @Get(":externalId/report")
  async report(@Param("externalId") id: string,
    @Headers("x-vsm-integration-key") key: string | undefined) {
    requireIntegrationKey(key);
    const result = await this.reporting.report(externalId(id));
    if (!result) throw new NotFoundException({ code: "external_user_not_found" });
    return result;
  }

  @Get(":externalId/report.csv")
  async reportCsv(@Param("externalId") id: string,
    @Headers("x-vsm-integration-key") key: string | undefined,
    @Res() reply: FastifyReply) {
    requireIntegrationKey(key);
    const result = await this.reporting.report(externalId(id));
    if (!result) throw new NotFoundException({ code: "external_user_not_found" });
    const rows = ["external_user_id,session_id,scenario_id,mode,outcome,score,spoken_actions,successful_checks,counts_for_training,vip_status,policy_version",
      ...result.sessions.map(item => [result.externalUserId, item.sessionId, item.scenarioId, item.mode,
        item.outcome, item.score, item.spokenActions, item.successfulChecks, item.countsForTraining,
        result.vipReadiness.status, result.vipReadiness.policyVersion].map(csvCell).join(","))];
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", "attachment; filename=training-report.csv");
    return reply.send("\uFEFF" + rows.join("\r\n") + "\r\n");
  }
}
