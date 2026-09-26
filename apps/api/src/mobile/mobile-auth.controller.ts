import { Controller, Get, Headers, UnauthorizedException } from "@nestjs/common";
import { validMobileAccess } from "./mobile-auth";

@Controller("mobile")
export class MobileAuthController {
  @Get("auth")
  auth(@Headers("cookie") cookie?: string): void {
    const token = cookie?.split(";").map((item) => item.trim())
      .find((item) => item.startsWith("vsm_mobile="))?.slice("vsm_mobile=".length);
    if (!validMobileAccess(token)) throw new UnauthorizedException();
  }
}
