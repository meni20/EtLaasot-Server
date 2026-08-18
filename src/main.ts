import { AppModule, runtimeEnvironment } from './app.module';
import { NestFactory } from '@nestjs/core';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { getOptionalEnv, isProduction } from './config/env.util';

const parseCorsOrigins = () => {
  const configuredOrigins = getOptionalEnv('CORS_ORIGINS');

  if (configuredOrigins) {
    return configuredOrigins
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  if (isProduction()) {
    throw new Error('Missing required environment variable: CORS_ORIGINS');
  }

  return ['http://localhost:5173', 'http://localhost:5174'];
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });

  app.enableCors({
    origin: parseCorsOrigins(),
    credentials: true,
  });

  app.use((req, res, next) => {
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      if (durationMs >= 250) {
        console.warn(
          `[slow-request] ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(1)}ms`,
        );
      }
    });

    next();
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: (errors) => {
        return new BadRequestException({
          message: 'Validation failed',
          errors: errors.map((error) => ({
            property: error.property,
            constraints: error.constraints,
          })),
        });
      },
    }),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
  console.log(
    `Environment target: ${runtimeEnvironment.target} (branch: ${runtimeEnvironment.branch})`,
  );
  console.log(`Server running on 0.0.0.0:${port}`);
}
bootstrap();
