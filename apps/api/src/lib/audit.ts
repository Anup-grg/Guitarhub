import type { Request } from "express";
import { prisma } from "./prisma.js";
import { newId } from "./id.js";
import { logger } from "./logger.js";

export type AuditInput = {
  actorId?: string | null;
  action: string;
  target: string;
  meta?: Record<string, unknown>;
  ip?: string | null;
};

/** Auth + admin security log (SRS §6.6). Never throws into the request path. */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        id: newId(),
        actorId: input.actorId ?? null,
        action: input.action,
        target: input.target,
        meta: (input.meta ?? {}) as never,
        ip: input.ip ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, action: input.action }, "failed to write audit log");
  }
}

export function clientIp(req: Request): string | null {
  return req.ip ?? null;
}
