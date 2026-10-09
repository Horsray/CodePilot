/**
 * codepilot-email MCP — in-process MCP server for email sending.
 *
 * Provides 3 tools:
 * - codepilot_send_email: Send plain text or HTML email
 * - codepilot_send_email_with_attachment: Send email with file attachment
 * - codepilot_verify_email_config: Test SMTP connection
 *
 * Globally registered: available in all contexts.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

export function getSmtpConfig() {
  return {
    host: process.env.MAIL_SERVER || 'smtp.exmail.qq.com',
    port: parseInt(process.env.MAIL_PORT || '465', 10),
    secure: parseInt(process.env.MAIL_PORT || '465', 10) === 465,
    auth: {
      user: process.env.MAIL_USERNAME || '',
      pass: process.env.MAIL_PASSWORD || '',
    },
  };
}

function getAssetsPath() {
  return process.env.EMAIL_ASSETS_PATH || '/Users/horsray/Documents/codepilot/CodePilot/public/email-assets';
}

export interface EmailTemplateData {
  title?: string;
  greeting?: string;
  body?: string;
  footer?: string;
}

export function buildHtmlEmail(data: EmailTemplateData): string {
  const assetsPath = getAssetsPath();
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${data.title || '西安绘影智能科技有限公司'}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif; background: #f5f6fa; }
.container { max-width: 600px; margin: 0 auto; background: #ffffff; }
.header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 40px 30px; text-align: center; }
.logo { width: 160px; height: auto; margin-bottom: 20px; }
.company-name { color: #ffffff; font-size: 22px; font-weight: 600; letter-spacing: 2px; }
.content { padding: 40px 30px; }
.greeting { color: #1a1a2e; font-size: 18px; font-weight: 600; margin-bottom: 20px; }
.body { color: #4a4a4a; font-size: 15px; line-height: 1.8; white-space: pre-wrap; }
.divider { height: 1px; background: #e8e8e8; margin: 30px 0; }
.footer { background: #f8f9fc; padding: 30px; text-align: center; }
.qrcode { width: 120px; height: 120px; border-radius: 8px; margin-bottom: 15px; }
.footer-text { color: #8a8a8a; font-size: 12px; line-height: 1.6; }
.footer-text a { color: #4a90d9; text-decoration: none; }
.avatar { width: 60px; height: 60px; border-radius: 50%; border: 3px solid #ffffff; box-shadow: 0 2px 8px rgba(0,0,0,0.15); margin-bottom: 15px; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <img src="cid:logo" alt="绘影科技" class="logo">
    <div class="company-name">西安绘影智能科技有限公司</div>
  </div>
  <div class="content">
    ${data.greeting ? `<div class="greeting">${data.greeting}</div>` : ''}
    ${data.body ? `<div class="body">${data.body}</div>` : ''}
    <div class="divider"></div>
    <div class="footer">
      <img src="cid:qrcode" alt="二维码" class="qrcode">
      <div class="footer-text">
        <img src="cid:avatar" alt="avatar" class="avatar" style="display:none"><br>
        西安绘影智能科技有限公司<br>
        <a href="https://www.huiyingai.cn">www.huiyingai.cn</a>
      </div>
    </div>
  </div>
</div>
</body>
</html>`;
}

export function getEmailAttachments() {
  const assetsPath = getAssetsPath();
  return [
    { filename: 'logo.png', path: `${assetsPath}/logo.png`, cid: 'logo' },
    { filename: 'qrcode.jpg', path: `${assetsPath}/qrcode.jpg`, cid: 'qrcode' },
    { filename: 'avatar.jpg', path: `${assetsPath}/avatar.jpg`, cid: 'avatar' },
  ];
}

export const EMAIL_MCP_SYSTEM_PROMPT = `## 邮件收发

你可以使用 codepilot-email MCP 发送邮件：

- codepilot_send_email: 发送纯文本或 HTML 邮件（支持抄送、密送）
- codepilot_send_email_with_attachment: 发送带附件的邮件（指定本地文件路径）
- codepilot_verify_email_config: 验证 SMTP 配置是否可用

默认发件人：MAIL_USERNAME 环境变量（servers@hueyingai.cn）
默认收件人：用户个人邮箱（252594598@qq.com）

使用场景：
- 用户说"发邮件给..." → 用 codepilot_send_email
- 用户说"把文件发到邮箱" → 用 codepilot_send_email_with_attachment
- 用户说"测试邮箱配置" → 用 codepilot_verify_email_config`;

export function createEmailMcpServer() {
  return createSdkMcpServer({
    name: 'codepilot-email',
    version: '1.0.0',
    tools: [
      // Tool 1: Send email
      tool(
        'codepilot_send_email',
        'Send an email via SMTP. Supports plain text and HTML body, CC and BCC.',
        {
          to: z.string().describe('Recipient email address(es), comma-separated'),
          subject: z.string().describe('Email subject'),
          body: z.string().describe('Email body content'),
          html: z.boolean().optional().default(false).describe('true if body is HTML, false for plain text'),
          cc: z.string().optional().describe('CC recipients, comma-separated'),
          bcc: z.string().optional().describe('BCC recipients, comma-separated'),
        },
        async ({ to, subject, body, html, cc, bcc }) => {
          try {
            const nodemailer = await import('nodemailer');
            const config = getSmtpConfig();
            if (!config.auth.user || !config.auth.pass) {
              return { content: [{ type: 'text' as const, text: 'Error: MAIL_USERNAME and MAIL_PASSWORD environment variables are not set.' }] };
            }
            const transporter = nodemailer.createTransport(config);
            const attachments = getEmailAttachments();
            const mailOptions: Record<string, unknown> = {
              from: `绘影科技 <${config.auth.user}>`,
              to,
              subject,
              attachments,
            };
            if (html) {
              mailOptions.html = body;
            } else {
              mailOptions.html = buildHtmlEmail({
                body,
              });
            }
            if (cc) mailOptions.cc = cc;
            if (bcc) mailOptions.bcc = bcc;
            const info = await transporter.sendMail(mailOptions);
            return { content: [{ type: 'text' as const, text: `Email sent successfully. Message ID: ${info.messageId}` }] };
          } catch (err) {
            return { content: [{ type: 'text' as const, text: `Failed to send email: ${err instanceof Error ? err.message : 'unknown'}` }] };
          }
        },
      ),

      // Tool 2: Send email with attachment
      tool(
        'codepilot_send_email_with_attachment',
        'Send an email with file attachment(s). Specify local file paths.',
        {
          to: z.string().describe('Recipient email address(es), comma-separated'),
          subject: z.string().describe('Email subject'),
          body: z.string().describe('Email body (plain text or HTML)'),
          html: z.boolean().optional().default(false).describe('true if body is HTML'),
          attachments: z.array(z.object({
            filename: z.string().describe('Display filename for the attachment'),
            path: z.string().describe('Local file path to attach'),
          })).describe('Array of attachments with filename and local path'),
          cc: z.string().optional().describe('CC recipients, comma-separated'),
          bcc: z.string().optional().describe('BCC recipients, comma-separated'),
        },
        async ({ to, subject, body, html, attachments, cc, bcc }) => {
          try {
            const nodemailer = await import('nodemailer');
            const fs = await import('fs');
            const config = getSmtpConfig();
            if (!config.auth.user || !config.auth.pass) {
              return { content: [{ type: 'text' as const, text: 'Error: MAIL_USERNAME and MAIL_PASSWORD environment variables are not set.' }] };
            }
            // Validate all files exist before sending
            for (const att of attachments) {
              if (!fs.existsSync(att.path)) {
                return { content: [{ type: 'text' as const, text: `Error: File not found: ${att.path}` }] };
              }
            }
            const transporter = nodemailer.createTransport(config);
            const emailAttachments = getEmailAttachments();
            const mailOptions: Record<string, unknown> = {
              from: `绘影科技 <${config.auth.user}>`,
              to,
              subject,
              attachments: [...emailAttachments, ...attachments.map((a: { filename: string; path: string }) => ({ filename: a.filename, path: a.path }))],
            };
            if (html) mailOptions.html = body;
            else mailOptions.html = buildHtmlEmail({ body });
            if (cc) mailOptions.cc = cc;
            if (bcc) mailOptions.bcc = bcc;
            const info = await transporter.sendMail(mailOptions);
            return { content: [{ type: 'text' as const, text: `Email with ${attachments.length} attachment(s) sent. Message ID: ${info.messageId}` }] };
          } catch (err) {
            return { content: [{ type: 'text' as const, text: `Failed to send email: ${err instanceof Error ? err.message : 'unknown'}` }] };
          }
        },
      ),

      // Tool 3: Verify SMTP config
      tool(
        'codepilot_verify_email_config',
        'Test SMTP connection to verify email configuration is working.',
        {},
        async () => {
          try {
            const nodemailer = await import('nodemailer');
            const config = getSmtpConfig();
            if (!config.auth.user || !config.auth.pass) {
              return { content: [{ type: 'text' as const, text: 'Error: MAIL_USERNAME and MAIL_PASSWORD environment variables are not set.' }] };
            }
            const transporter = nodemailer.createTransport(config);
            await transporter.verify();
            return { content: [{ type: 'text' as const, text: `SMTP connection verified successfully.\nServer: ${config.host}:${config.port}\nUser: ${config.auth.user}` }] };
          } catch (err) {
            return { content: [{ type: 'text' as const, text: `SMTP verification failed: ${err instanceof Error ? err.message : 'unknown'}` }] };
          }
        },
      ),
    ],
  });
}
