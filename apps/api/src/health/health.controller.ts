import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type { HealthResponseDto } from "@vsm/api-contracts";

@ApiTags("system")
@Controller("health")
export class HealthController {
  @Get()
  @ApiOkResponse({ description: "API готов принимать запросы" })
  getHealth(): HealthResponseDto {
    return {
      status: "ok",
      service: "vsm-api",
      timestamp: new Date().toISOString(),
    };
  }
}
