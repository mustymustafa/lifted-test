import { Global, Module } from '@nestjs/common';
import { Clock, SystemClock } from './clock';
import { AppConfig, loadConfig } from '../config/config';
import { Mutex } from './mutex';

/** Process-wide singletons shared by every feature module. */
@Global()
@Module({
  providers: [
    { provide: Clock, useClass: SystemClock },
    { provide: AppConfig, useFactory: () => loadConfig() },
    Mutex,
  ],
  exports: [Clock, AppConfig, Mutex],
})
export class CommonModule {}
