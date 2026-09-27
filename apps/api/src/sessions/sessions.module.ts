import { Module } from "@nestjs/common";

import { SessionsController } from "./sessions.controller";
import { ProfilesController } from "./profiles.controller";
import { SessionsService } from "./sessions.service";
import {
  MemorySessionRepository,
  SessionRepository,
} from "./session.repository";
import { PostgresSessionRepository } from "./postgres-session.repository";
import { FreeformService } from "../ai/freeform.service";
import { AiAdapterService } from "../ai/ai-adapter.service";
import { AppConfigController, LeaderboardController, RzdIntegrationController } from "../reporting/reporting.controller";
import { ReportingService } from "../reporting/reporting.service";

@Module({
  controllers: [SessionsController, ProfilesController, AppConfigController, LeaderboardController, RzdIntegrationController],
  providers: [
    SessionsService,
    FreeformService,
    AiAdapterService,
    ReportingService,
    {
      provide: SessionRepository,
      useFactory: () => {
        if (process.env.PGHOST) return new PostgresSessionRepository();
        if (process.env.NODE_ENV === "production")
          throw new Error("PGHOST is required in production");
        return new MemorySessionRepository();
      },
    },
  ],
  exports: [SessionRepository],
})
export class SessionsModule {}
