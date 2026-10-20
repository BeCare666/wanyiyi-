import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { MemberGuard } from "./auth/member.guard";
import { RequestLoggingInterceptor } from "./common/request-logging.interceptor";
import { type Env, validateEnv } from "./config/env";
import { AdminEventsController } from "./events/admin-events.controller";
import { EventsController } from "./events/events.controller";
import { HealthController } from "./health/health.controller";
import { AuthHooksController } from "./hooks/auth-hooks.controller";
import { AuthHooksService } from "./hooks/auth-hooks.service";
import {
  BrevoEmailSender,
  BrevoSmsSender,
  EMAIL_SENDER,
  SimulatedEmailSender,
  SimulatedSmsSender,
  SMS_SENDER,
} from "./notifications/senders";
import { DeliveriesService } from "./notifications/deliveries.service";
import { PaymentsController } from "./payments/payments.controller";
import { PAYMENT_PROVIDER, PaymentsService, SimulatedPaymentProvider } from "./payments/payments.service";
import { ProfileController } from "./profile/profile.controller";
import { JobsService } from "./scheduler/jobs.service";
import { SupabaseService } from "./supabase/supabase.service";
import { AdminVerificationsController } from "./verifications/admin-verifications.controller";

/**
 * Module racine. Phase 2 : authentification (hooks SMS et e-mail via Brevo), profil,
 * soirées, vote QR, matchs, paiements (adaptateur simulé), tâches planifiées,
 * vérifications côté équipe (liens signés vers les pièces).
 * Les adaptateurs (SMS, e-mail, paiement) sont choisis par la configuration.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }), ScheduleModule.forRoot()],
  controllers: [HealthController, AuthHooksController, EventsController, AdminEventsController, AdminVerificationsController, PaymentsController, ProfileController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
    SupabaseService,
    MemberGuard,
    AuthHooksService,
    PaymentsService,
    JobsService,
    DeliveriesService,
    {
      provide: SMS_SENDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get("SMS_PROVIDER", { infer: true }) === "brevo"
          ? new BrevoSmsSender(config.get("BREVO_API_KEY", { infer: true })!, config.get("BREVO_SMS_SENDER", { infer: true })!)
          : new SimulatedSmsSender(),
    },
    {
      provide: EMAIL_SENDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get("EMAIL_PROVIDER", { infer: true }) === "brevo"
          ? new BrevoEmailSender(
              config.get("BREVO_API_KEY", { infer: true })!,
              config.get("BREVO_SENDER_EMAIL", { infer: true })!,
              config.get("BREVO_SENDER_NAME", { infer: true }),
            )
          : new SimulatedEmailSender(),
    },
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        if (config.get("PAYMENT_PROVIDER", { infer: true }) === "fedapay") {
          // Adaptateur FedaPay non écrit : question 7 de PHASE2.txt en attente
          throw new Error("Adaptateur FedaPay pas encore disponible (question 7 de PHASE2.txt)");
        }
        return new SimulatedPaymentProvider(config.get("WEB_ORIGIN", { infer: true }));
      },
    },
  ],
})
export class AppModule {}
