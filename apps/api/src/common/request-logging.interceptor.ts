import { type CallHandler, type ExecutionContext, Injectable, Logger, type NestInterceptor } from "@nestjs/common";
import type { Request, Response } from "express";
import { type Observable, tap } from "rxjs";

/**
 * Journal des requêtes : méthode, chemin, statut, durée.
 * Jamais de corps de requête, d'en-tête d'autorisation ni de paramètre de requête :
 * ils peuvent contenir des données personnelles ou des jetons.
 */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger("HTTP");

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const started = Date.now();
    const path = req.path;

    return next.handle().pipe(
      tap({
        next: () => this.log(req.method, path, http.getResponse<Response>().statusCode, started),
        error: (err: { status?: number }) => this.log(req.method, path, err?.status ?? 500, started),
      }),
    );
  }

  private log(method: string, path: string, status: number, started: number) {
    this.logger.log(`${method} ${path} ${status} ${Date.now() - started}ms`);
  }
}
