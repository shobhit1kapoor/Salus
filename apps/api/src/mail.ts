import nodemailer from "nodemailer";
import { env } from "./env.js";
const transport = env.SMTP_HOST && env.SMTP_PORT ? nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: false }) : null;
export async function sendMail(to: string, subject: string, text: string) {
  if (!transport || !env.SMTP_FROM) throw new Error("SMTP is not configured");
  await transport.sendMail({ from: env.SMTP_FROM, to, subject, text });
}
