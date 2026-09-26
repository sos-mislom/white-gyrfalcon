import { BadRequestException, Controller, Get, Headers } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { SessionsService } from "./sessions.service";

@ApiTags("profiles")
@Controller("profiles")
export class ProfilesController {
  constructor(private readonly sessions: SessionsService) {}

  @Get("me")
  async me(@Headers("x-vsm-device-id") deviceId?: string) {
    if (!deviceId || !/^[a-f0-9]{64}$/.test(deviceId))
      throw new BadRequestException({ code: "invalid_device_id" });
    return this.sessions.profileSessions(deviceId);
  }
}
