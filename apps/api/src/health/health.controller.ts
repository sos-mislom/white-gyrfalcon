import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type { HealthResponseDto } from "@vsm/api-contracts";
import { SessionRepository } from "../sessions/session.repository";

@ApiTags("system")
@Controller("health")
export class HealthController {
  constructor(private readonly repository: SessionRepository) {}
  @Get()
  @ApiOkResponse({ description: "API готов принимать запросы" })
  async getHealth(): Promise<HealthResponseDto> {
    if (!(await this.repository.ready()))
      throw new ServiceUnavailableException({ code: "storage_unavailable" });
    return {
      status: "ok",
      service: "vsm-api",
      timestamp: new Date().toISOString(),
    };
  }
}
