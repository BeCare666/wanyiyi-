import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { AdminAccountsController } from "./accounts/admin-accounts.controller";
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
  DisabledSmsSender,
  EMAIL_SENDER,
  SimulatedEmailSender,
  SimulatedSmsSender,
  SMS_SENDER,
} from "./notifications/senders";
import { DeliveriesService } from "./notifications/deliveries.service";
import { CagnottesController } from "./payments/cagnottes.controller";
import { FeexpayWebhookController, PaymentsController } from "./payments/payments.controller";
import { FeexpayClient } from "./payments/feexpay";
import { FeexpayPaymentProvider, PAYMENT_PROVIDER, PaymentsService, SimulatedPaymentProvider } from "./payments/payments.service";
import { PhotosController, PhotoViewController } from "./photos/photos.controller";
import { ProfileController } from "./profile/profile.controller";
import { AdminProvidersController } from "./providers/admin-providers.controller";
import { JobsService } from "./scheduler/jobs.service";
import { SupabaseService } from "./supabase/supabase.service";
import { AdminVerificationsController } from "./verifications/admin-verifications.controller";

/**
 * Module racine. Phase 2 : authentification (hooks SMS et e-mail via Brevo), profil,
 * soirées, vote QR, matchs, paiements (FeexPay ou adaptateur simulé), tâches planifiées,
 * vérifications côté équipe (liens signés vers les pièces). Phase 3 : photos des membres
 * (dépôt réduit et sans métadonnées, affichage filigrané par lien de 5 minutes). Phase 4 :
 * photos de l'union (même module), images des prestataires envoyées sur Cloudinary.
 * Les adaptateurs (SMS, e-mail, paiement) sont choisis par la configuration.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }), ScheduleModule.forRoot()],
  controllers: [HealthController, AuthHooksController, EventsController, AdminEventsController, AdminVerificationsController, FeexpayWebhookController, PaymentsController, ProfileController, PhotosController, PhotoViewController, AdminProvidersController, CagnottesController, AdminAccountsController],
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
      useFactory: (config: ConfigService<Env, true>) => {
        const provider = config.get("SMS_PROVIDER", { infer: true });
        if (provider === "brevo") return new BrevoSmsSender(config.get("BREVO_API_KEY", { infer: true })!, config.get("BREVO_SMS_SENDER", { infer: true })!);
        return provider === "simulated" ? new SimulatedSmsSender() : new DisabledSmsSender();
      },
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
        const webOrigin = config.get("WEB_ORIGIN", { infer: true });
        if (config.get("PAYMENT_PROVIDER", { infer: true }) === "feexpay") {
          // FeexPay retenu le 22 octobre 2026 (question 29) ; clés contrôlées par validateEnv
          const keys = { apiKey: config.get("FEEXPAY_API_KEY", { infer: true })!, shop: config.get("FEEXPAY_SHOP_ID", { infer: true })! };
          const sandbox = config.get("FEEXPAY_SANDBOX", { infer: true });
          return new FeexpayPaymentProvider(new FeexpayClient(keys, sandbox), sandbox, webOrigin);
        }
        return new SimulatedPaymentProvider(webOrigin);
      },
    },
  ],
})
export class AppModule {}
