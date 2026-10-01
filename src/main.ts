import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppConfig } from './config/config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const { port } = app.get(AppConfig);
  await app.listen(port);
  new Logger('Bootstrap').log(`GraphQL ready at http://localhost:${port}/graphql`);
}

void bootstrap();
