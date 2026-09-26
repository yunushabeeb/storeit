import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import { shareAccessLine } from '@/constants';

const subject = 'Your StoreIt sign-in code';

// Development always uses Mailpit, even when RESEND_API_KEY is present.
// The default Resend key only delivers to the account that owns it, which
// blocks local sign-in for any other address. Production is where Resend runs.
function sendsWithResend() {
  return process.env.NODE_ENV === 'production' && Boolean(process.env.RESEND_API_KEY);
}

function fromAddress() {
  const configured = process.env.MAIL_FROM?.trim();
  const placeholder = !configured || configured.includes('storeit.local');

  // Resend rejects noreply@storeit.local. The default key may send as
  // onboarding@resend.dev until a domain is verified.
  if (sendsWithResend() && placeholder) {
    return 'StoreIt <onboarding@resend.dev>';
  }

  return configured || 'StoreIt <noreply@storeit.local>';
}

function textMessage(code: string) {
  return [
    'Your StoreIt sign-in code',
    '',
    code,
    '',
    'Enter this code to continue. It expires in 10 minutes and can only be used once.',
    'If you did not try to sign in, you can ignore this email.',
  ].join('\n');
}

function htmlMessage(code: string) {
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;background:#f2f5f9;color:#333f4e;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f5f9;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#ffffff;border-radius:20px;padding:36px 32px;">
            <tr>
              <td>
                <p style="margin:0 0 20px;font-family:ui-sans-serif,system-ui,sans-serif;font-size:18px;font-weight:700;letter-spacing:-0.03em;color:#fa7275;">StoreIt</p>
                <h1 style="margin:0 0 12px;font-family:ui-sans-serif,system-ui,sans-serif;font-size:24px;font-weight:600;line-height:1.25;color:#333f4e;">Your sign-in code</h1>
                <p style="margin:0 0 28px;font-family:ui-sans-serif,system-ui,sans-serif;font-size:15px;line-height:1.6;color:#333f4e;">Enter this code to continue. It expires in 10 minutes and can only be used once.</p>
                <p style="margin:0 0 28px;padding:16px 0;border-top:1px solid #f2f4f8;border-bottom:1px solid #f2f4f8;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:32px;font-weight:600;letter-spacing:0.28em;color:#333f4e;">${code}</p>
                <p style="margin:0;font-family:ui-sans-serif,system-ui,sans-serif;font-size:13px;line-height:1.5;color:#a3b2c7;">If you did not try to sign in, you can ignore this email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

type OutboundMail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function appOrigin() {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function emailShell(title: string, bodyHtml: string) {
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;background:#f2f5f9;color:#333f4e;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f5f9;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#ffffff;border-radius:20px;padding:36px 32px;">
            <tr>
              <td>
                <p style="margin:0 0 20px;font-family:ui-sans-serif,system-ui,sans-serif;font-size:18px;font-weight:700;letter-spacing:-0.03em;color:#fa7275;">StoreIt</p>
                <h1 style="margin:0 0 12px;font-family:ui-sans-serif,system-ui,sans-serif;font-size:24px;font-weight:600;line-height:1.25;color:#333f4e;">${title}</h1>
                ${bodyHtml}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function deliver(message: OutboundMail) {
  if (sendsWithResend()) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const result = await resend.emails.send({
      from: fromAddress(),
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    if (result.error) throw new Error(result.error.message);
    return;
  }

  const host = process.env.SMTP_HOST;

  if (!host) {
    throw new Error('Email is not configured. Set RESEND_API_KEY or SMTP_HOST.');
  }

  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 1025),
    secure: false,
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  });

  await transporter.sendMail({
    from: fromAddress(),
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}

export async function sendOtpEmail(email: string, code: string) {
  // The terminal line is the local fallback when Mailpit is not open.
  // Production does not print the code.
  if (process.env.NODE_ENV !== 'production') {
    console.info(`[storeit] OTP for ${email}: ${code} (Mailpit: http://localhost:8026)`);
  }

  try {
    await deliver({
      to: email,
      subject,
      text: textMessage(code),
      html: htmlMessage(code),
    });
  } catch (error) {
    // A failed production send must fail the sign-in. In development the code
    // is already in the server log, so Mailpit being down does not block it.
    if (process.env.NODE_ENV === 'production') throw error;

    console.error('Failed to send OTP email.', error);
  }
}

export async function sendShareEmail({
  to,
  fileName,
  sharerName,
  hasAccount,
  permissions,
}: {
  to: string;
  fileName: string;
  sharerName: string;
  hasAccount: boolean;
  permissions: string[];
}) {
  const origin = appOrigin();
  const safeSharer = escapeHtml(sharerName);
  const safeFile = escapeHtml(fileName);
  const safeTo = escapeHtml(to);
  const continueUrl = hasAccount
    ? `${origin}/sign-in?email=${encodeURIComponent(to)}`
    : `${origin}/sign-up?email=${encodeURIComponent(to)}`;
  const action = hasAccount ? 'Open StoreIt' : 'Create your account';
  const accessLine = shareAccessLine(permissions);
  // An existing account can sign in and the file is already in their library.
  // A new address has to sign up with this same inbox, because that is the
  // value stored on the share. A different address would not see the file.
  const text = hasAccount
    ? [
        `${sharerName} shared “${fileName}” with you on StoreIt.`,
        '',
        accessLine,
        '',
        'Sign in and it will be in your library.',
        continueUrl,
      ].join('\n')
    : [
        `${sharerName} shared “${fileName}” with you on StoreIt.`,
        '',
        accessLine,
        '',
        `There is no StoreIt account for ${to} yet.`,
        '',
        'Create one with this email address and the file will be waiting in your library.',
        continueUrl,
      ].join('\n');
  const name = `<strong style="font-weight:700;">${safeSharer}</strong>`;
  const file = `<strong style="font-weight:700;">${safeFile}</strong>`;
  const address = `<strong style="font-weight:700;">${safeTo}</strong>`;
  const paragraph =
    'margin:0 0 12px;font-family:ui-sans-serif,system-ui,sans-serif;font-size:15px;line-height:1.6;color:#333f4e;';
  const access = `<p style="${paragraph}"><strong style="font-weight:700;">${escapeHtml(accessLine)}</strong></p>`;
  const detail = hasAccount
    ? `<p style="${paragraph}">${name} shared “${file}” with you.</p>${access}<p style="${paragraph}margin-bottom:28px;">Sign in and it will be in your library.</p>`
    : `<p style="${paragraph}">${name} shared “${file}” with you. There is no StoreIt account for ${address} yet.</p>${access}<p style="${paragraph}margin-bottom:28px;">Create one with <strong style="font-weight:700;">this email address</strong> and the file will be waiting in your library.</p>`;

  try {
    await deliver({
      to,
      subject: `${sharerName} shared a file with you`,
      text,
      html: emailShell(
        'A file was shared with you',
        `${detail}<a href="${continueUrl}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#fa7275;color:#ffffff;font-family:ui-sans-serif,system-ui,sans-serif;font-size:14px;font-weight:600;text-decoration:none;">${action}</a>`,
      ),
    });
  } catch (error) {
    if (process.env.NODE_ENV === 'production') throw error;

    console.error('Failed to send share email.', error);
  }
}
