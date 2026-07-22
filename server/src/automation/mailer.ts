import fs from "fs";
import nodemailer from "nodemailer";
import { env } from "../env";

export interface SendArgs {
  toEmail: string;
  subject: string;
  body: string;
  resumePath: string;
  resumeFilename: string;
  auth:
    | { type: "app_password"; fromAddress: string; fromAppPassword: string }
    | { type: "oauth2"; fromAddress: string; refreshToken: string };
}

export async function sendOutreachEmail(args: SendArgs): Promise<void> {
  if (!fs.existsSync(args.resumePath)) {
    throw new Error(`Resume not found at ${args.resumePath}`);
  }

  const auth =
    args.auth.type === "oauth2"
      ? {
          type: "OAuth2" as const,
          user: args.auth.fromAddress,
          clientId: env.googleClientId,
          clientSecret: env.googleClientSecret,
          refreshToken: args.auth.refreshToken,
        }
      : { user: args.auth.fromAddress, pass: args.auth.fromAppPassword };

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth,
  });

  await transporter.sendMail({
    from: args.auth.fromAddress,
    to: args.toEmail,
    subject: args.subject,
    text: args.body,
    attachments: [{ filename: args.resumeFilename, path: args.resumePath, contentType: "application/pdf" }],
  });
}
