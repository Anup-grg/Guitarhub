import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMailSpy, createTransportSpy } = vi.hoisted(() => {
  const sendMailSpy = vi.fn(async () => ({ accepted: [] as string[] }));
  const createTransportSpy = vi.fn(() => ({ sendMail: sendMailSpy }));
  return { sendMailSpy, createTransportSpy };
});

vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportSpy },
}));

import { env } from "../config.js";
import { outbox, sendMail } from "./mailer.js";

beforeEach(() => {
  outbox.length = 0;
  env.SMTP_URL = "";
  sendMailSpy.mockClear();
  createTransportSpy.mockClear();
});

describe("sendMail", () => {
  it("captures mail in the dev outbox when SMTP is not configured", async () => {
    await sendMail({ to: "ada@example.com", subject: "Hi", text: "hello" });

    expect(outbox).toEqual([{ to: "ada@example.com", subject: "Hi", text: "hello" }]);
    expect(createTransportSpy).not.toHaveBeenCalled();
    expect(sendMailSpy).not.toHaveBeenCalled();
  });

  it("hands mail to nodemailer and reuses one transport across sends", async () => {
    env.SMTP_URL = "smtp://localhost:1025";

    await sendMail({ to: "ada@example.com", subject: "Hi", text: "hello" });
    await sendMail({ to: "ada@example.com", subject: "Hi again", text: "hello again" });

    expect(createTransportSpy).toHaveBeenCalledWith("smtp://localhost:1025");
    expect(createTransportSpy).toHaveBeenCalledTimes(1);
    expect(sendMailSpy).toHaveBeenCalledTimes(2);
    expect(sendMailSpy).toHaveBeenCalledWith({
      from: env.MAIL_FROM,
      to: "ada@example.com",
      subject: "Hi",
      text: "hello",
    });
    expect(outbox).toHaveLength(0);
  });

  it("carries optional html bodies through", async () => {
    await sendMail({ to: "ada@example.com", subject: "Hi", text: "hello", html: "<b>hi</b>" });

    expect(outbox[0]!.html).toBe("<b>hi</b>");
  });
});
