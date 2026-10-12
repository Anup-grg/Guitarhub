import { z } from "zod";
import { env } from "../config.js";
import { isBreachedPassword } from "./password.js";

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email()
  .transform((v) => v.toLowerCase());

export const MIN_PASSWORD_LENGTH = 12;

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(200)
  .superRefine(async (value, ctx) => {
    const enabled = env.HIBP_CHECK || env.NODE_ENV === "production";
    if (!enabled) return;
    if (await isBreachedPassword(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "This password appears in a known data breach — choose another one",
      });
    }
  });

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, "Display name must be at least 2 characters")
  .max(40)
  .refine((v) => !/[<>]/.test(v), "Display name contains unsupported characters")
  .refine((v) => !/^@/.test(v) || v.length > 1, "Display name cannot start with @");

export const bioSchema = z.string().trim().max(500).optional();

export const profileLinkSchema = z.object({
  label: z.string().trim().min(1).max(30),
  url: z
    .string()
    .trim()
    .max(500)
    .url()
    .refine((u) => /^https?:\/\//i.test(u), "Links must be http(s)"),
});

export const linksSchema = z.array(profileLinkSchema).max(6).optional();

export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app");

export const recoveryCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/, "Recovery codes look like ABCDE-FGHJK");

export const tosSchema = z.object({
  tosVersion: z.string().trim().min(1),
  acceptTerms: z.literal(true, {
    errorMap: () => ({ message: "You must accept the Terms of Service" }),
  }),
  acceptGuidelines: z.literal(true, {
    errorMap: () => ({ message: "You must accept the Community Guidelines" }),
  }),
});
