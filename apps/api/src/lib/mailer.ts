import nodemailer from "nodemailer";
import { env } from "../config.js";
import { logger } from "./logger.js";

export type OutgoingMail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

/** Dev/test outbox: populated when SMTP_URL is not configured. */
export const outbox: OutgoingMail[] = [];

let transporter: ReturnType<typeof nodemailer.createTransport> | undefined;

export async function sendMail(mail: OutgoingMail): Promise<void> {
  if (env.SMTP_URL) {
    transporter ??= nodemailer.createTransport(env.SMTP_URL);
    await transporter.sendMail({ from: env.MAIL_FROM, ...mail });
    return;
  }
  outbox.push(mail);
  logger.info({ to: mail.to, subject: mail.subject }, "mail (dev outbox)");
  if (env.NODE_ENV !== "production") {
    // Local development: surface the body so flows can be exercised without SMTP.
    logger.debug({ to: mail.to, body: mail.text }, "mail body (dev outbox)");
  }
}
