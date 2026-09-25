import { Module } from "@nestjs/common";

import { SessionsController } from "./sessions.controller";
import { SessionsService } from "./sessions.service";
import {
  MemorySessionRepository,
  SessionRepository,
} from "./session.repository";
import { PostgresSessionRepository } from "./postgres-session.repository";

@Module({
  controllers: [SessionsController],
  providers: [
    SessionsService,
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
