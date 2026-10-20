import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import type { Env } from "./config/env";

async function bootstrap() {
  // rawBody : nécessaire à la vérification de signature des hooks Supabase
  const app = await NestFactory.create(AppModule, { bufferLogs: false, rawBody: true });
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.setGlobalPrefix("api");
  app.enableCors({ origin: config.get("WEB_ORIGIN", { infer: true }), credentials: true });
  app.enableShutdownHooks();
  // Masque la signature du serveur
  app.getHttpAdapter().getInstance().disable("x-powered-by");

  // Documentation de l'API (hors production) : /api/docs
  if (config.get("NODE_ENV", { infer: true }) !== "production") {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("API Wanyiyi").setVersion("phase 2").addBearerAuth().build(),
    );
    SwaggerModule.setup("api/docs", app, document);
  }

  const port = config.get("PORT", { infer: true });
  // Toutes les interfaces : exigé par Render (et sans effet en local)
  await app.listen(port, "0.0.0.0");
  new Logger("Bootstrap").log(`API Wanyiyi prête sur le port ${port}`);
}

void bootstrap();
