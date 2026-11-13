import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const host = process.env.API_HOST ?? "127.0.0.1";
  if (!isLoopbackHost(host) && process.env.NODE_ENV === "production" && !process.env.AUTH_TOKEN_SECRET) throw new Error("AUTH_TOKEN_SECRET must be configured before binding the API to a public interface.");

  const app = await NestFactory.create(AppModule, { logger: ["error", "warn", "log"] });
  app.use(helmet());
  app.use((_request: Request, response: Response, next: NextFunction) => { response.setHeader("Cache-Control", "no-store"); next(); });
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:3000", credentials: true, methods: ["GET", "POST", "PATCH", "OPTIONS"], allowedHeaders: ["Content-Type", "x-csrf-token"] });
  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port, host);
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

void bootstrap();
