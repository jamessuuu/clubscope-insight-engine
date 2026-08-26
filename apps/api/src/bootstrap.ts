// Must be first: the decorator metadata that Nest's dependency injection and
// ValidationPipe's DTO discovery both read is written into this polyfill's registry.
import 'reflect-metadata';

import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import {
  API_DESCRIPTION,
  API_TAGS,
  API_TITLE,
  API_VERSION,
  SWAGGER_PATH,
} from './app.constants';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * Builds and configures the application without starting a listener.
 *
 * Split out from `main.ts` because the same app has to run two ways: as a long-lived process
 * locally, and as a Vercel function that is handed a request rather than a port. Both call
 * this, so there is exactly one definition of how the application is configured — a
 * serverless entry point that quietly forgot the global validation pipe is a class of bug
 * that only shows up in production.
 */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, {
    // JSON logs would be better in a real deployment; the readable logger is the right call
    // for something a reviewer runs in a terminal.
    logger: ['error', 'warn', 'log'],
  });

  app.enableCors({
    origin: corsOrigins(),
    methods: ['GET', 'POST', 'OPTIONS'],
    // No credentials: this API has no session and no cookies, so allowing them would widen
    // the surface for nothing.
    credentials: false,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      // Strip anything the DTO does not declare...
      whitelist: true,
      // ...and reject rather than silently drop it. A typo'd query parameter that is quietly
      // ignored produces a wrong answer with a 200 beside it, which is far worse than a 400.
      forbidNonWhitelisted: true,
      // Query strings arrive as strings; DTOs declare `@Type(() => Number)` where a number is
      // meant. Implicit conversion stays off so every coercion is written down.
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  configureSwagger(app);

  return app;
}

/**
 * CORS origins come from the environment with a local default.
 *
 * The web app runs on 3100 in development and on a Vercel domain in production, so a
 * hard-coded list would be wrong in one of the two places. `*` would also work here — this
 * API is read-only and unauthenticated — but writing the allowlist down keeps the habit
 * correct for the moment it stops being read-only.
 */
export function corsOrigins(): string[] {
  const configured = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return configured.length > 0 ? configured : ['http://localhost:3100', 'http://127.0.0.1:3100'];
}

export function configureSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle(API_TITLE)
    .setDescription(API_DESCRIPTION)
    .setVersion(API_VERSION)
    .addTag(API_TAGS.health, 'Liveness, dataset identity and which assistant mode is active')
    .addTag(API_TAGS.club, 'Club profile and the exact bounds of the data')
    .addTag(API_TAGS.members, 'Member directory and Member 360, with deterministic churn scoring')
    .addTag(API_TAGS.insights, 'The detected insight feed, each item carrying evidence and a verification report')
    .addTag(API_TAGS.tools, 'The grounding layer: the analysis registry, and running any tool for its Evidence')
    .addTag(API_TAGS.assistant, 'The question library and the assistant turn, including proposed actions')
    .addTag(API_TAGS.verification, 'The groundedness gate, exposed so the central claim can be attacked directly')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    customSiteTitle: API_TITLE,
    // The raw document is worth publishing: it is what a client generator consumes, and it
    // is the fastest way for a reviewer to diff the contract between two versions.
    jsonDocumentUrl: `${SWAGGER_PATH}/json`,
    swaggerOptions: {
      docExpansion: 'list',
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
      tryItOutEnabled: true,
    },
  });
}
