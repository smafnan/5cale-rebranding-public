import 'dotenv/config';

import { ConfigError, isLoopbackHost, loadConfig } from './config';
import { buildApp } from './http/app';
import { createServices } from './services';

async function main(): Promise<void> {
  const config = loadConfig();
  const services = await createServices(config);

  const pretty = process.stdout.isTTY && process.env.NODE_ENV !== 'production';
  const app = await buildApp(services, {
    logger: {
      level: config.logLevel,
      // Never let a key that ends up in an error object reach the log.
      redact: ['req.headers.authorization', 'req.headers.cookie', '*.apiKey', '*.key'],
      serializers: {
        // Log the path only: the WebSocket URL carries the access token in its query string.
        req: (request: { method?: string; url?: string; ip?: string }) => ({
          method: request.method,
          url: request.url?.split('?')[0],
          remoteAddress: request.ip,
        }),
      },
      ...(pretty
        ? {
            transport: {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
            },
          }
        : {}),
    },
  });

  const shutdown = (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    // Open calls would otherwise keep the process alive forever.
    void app.close().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 3_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: config.host });

  const status = services.providerStatus();
  const ready = (kind: 'stt' | 'mt' | 'tts') =>
    status[kind]
      .filter((p) => p.state === 'ready')
      .map((p) => p.id)
      .join(', ') || 'NONE';
  const displayHost = isLoopbackHost(config.host) ? 'localhost' : config.host;
  app.log.info(`Tarjuman is ready: http://${displayHost}:${config.port}`);
  app.log.info(`speech recognition: ${ready('stt')}`);
  app.log.info(`translation:        ${ready('mt')}`);
  app.log.info(`voice:              ${ready('tts')}`);
  if (config.mock) app.log.warn('TARJUMAN_MOCK is on: all providers are offline fakes.');
  if (!services.chains.stt.hasConfigured()) {
    app.log.warn(
      'No speech-recognition key yet. Open the app and add a free Groq key under Settings (typing still works without one).',
    );
  }
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`\n${error.message}\n`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
