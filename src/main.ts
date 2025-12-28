import { AppModule } from './app.module';
import { NestFactory } from '@nestjs/core';
import { BadRequestException, ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors();

  app.useGlobalPipes(
    new ValidationPipe({
      exceptionFactory: (errors) => {
        console.error(errors);
        return new BadRequestException();
      },
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
