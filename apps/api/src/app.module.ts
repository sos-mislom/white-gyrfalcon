import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { HealthController } from "./health/health.controller";
import { SessionsModule } from "./sessions/sessions.module";
import { MobileAuthController } from "./mobile/mobile-auth.controller";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), SessionsModule],
  controllers: [HealthController, MobileAuthController],
})
export class AppModule {}
