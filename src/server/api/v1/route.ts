/** The shape of one service API route: its schemas are both the validation and the documentation. */
import type { z } from "zod";
import type { ServiceActor } from "~/server/auth/service";

export type Method = "get" | "put" | "delete";

export interface RouteContext<P, B> {
  params: P;
  body: B;
  request: Request;
  /** Present on `auth: "service"` routes. */
  actor: ServiceActor | null;
}

export interface RouteResult {
  status: number;
  body: unknown;
}

export interface ResponseDef {
  description: string;
  schema: z.ZodType;
}

export interface RouteDef<P = unknown, B = unknown> {
  method: Method;
  /** Relative to `/api/v1`, with `{name}` placeholders matching `params` keys. */
  path: string;
  operationId: string;
  summary: string;
  description?: string;
  tags: string[];
  auth: "none" | "service";
  params?: z.ZodType<P>;
  body?: z.ZodType<B>;
  responses: Record<number, ResponseDef>;
  handler: (ctx: RouteContext<P, B>) => Promise<RouteResult>;
}

/** Keeps the handler's `params` and `body` typed from the schemas while the registry stays heterogeneous. */
export function defineRoute<P = undefined, B = undefined>(def: RouteDef<P, B>): RouteDef {
  return def as unknown as RouteDef;
}
