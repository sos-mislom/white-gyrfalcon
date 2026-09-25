import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
  await app.enableCors({ origin: webOrigin });

  const swaggerConfig = new DocumentBuilder()
    .setTitle("API тренажёра ВСМ")
    .setDescription("Управление учебными сменами и журналом действий")
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, document);

  const port = Number(process.env.API_PORT ?? 3100);
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
