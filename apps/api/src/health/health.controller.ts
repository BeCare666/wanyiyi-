import { Controller, Get } from "@nestjs/common";

/** État de l'API, utilisé par l'hébergeur et la supervision. Ne renvoie aucune donnée sensible. */
@Controller("health")
export class HealthController {
  @Get()
  check() {
    return {
      status: "ok",
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
