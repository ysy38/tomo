import net from "node:net";
import tls from "node:tls";
import { randomUUID } from "node:crypto";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { authMail } from "@/db/schema";

type Db = PgliteDatabase<any>;

export type OutboundMail = {
  to: string;
  purpose: string;
  subject: string;
  body: string;
};

export function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

function mailbox(value: string): string {
  const wrapped = value.match(/<([^>]+)>/);
  const address = (wrapped?.[1] ?? value).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error("Invalid mailbox");
  return address;
}

/** Plain-text SMTP DATA payload. Lines that start with a dot are stuffed, per RFC 5321. */
export function smtpData(message: { from: string; to: string; subject: string; body: string }): string {
  if (/[\r\n]/.test(message.from) || /[\r\n]/.test(message.to) || /[\r\n]/.test(message.subject)) {
    throw new Error("Mail header contains a line break");
  }
  const subject = `=?UTF-8?B?${Buffer.from(message.subject, "utf8").toString("base64")}?=`;
  const body = message.body
    .replace(/\r?\n/g, "\r\n")
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
  return [`From: ${message.from}`, `To: ${message.to}`, `Subject: ${subject}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", body].join("\r\n");
}

type SocketLike = net.Socket;

function readReplies(socket: SocketLike) {
  let buffer = "";
  const pending: string[] = [];
  const waiters: Array<(line: string) => void> = [];
  socket.on("data", (chunk: Buffer | string) => {
    buffer += chunk.toString();
    let split = buffer.indexOf("\r\n");
    while (split >= 0) {
      const line = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const waiter = waiters.shift();
      if (waiter) waiter(line);
      else pending.push(line);
      split = buffer.indexOf("\r\n");
    }
  });
  const line = () => {
    const ready = pending.shift();
    if (ready !== undefined) return Promise.resolve(ready);
    return new Promise<string>((resolve) => waiters.push(resolve));
  };
  return async function reply() {
    const lines: string[] = [];
    for (;;) {
      const next = await line();
      lines.push(next);
      if (/^\d{3} /.test(next)) break;
      if (!/^\d{3}-/.test(next)) break;
    }
    return { code: Number(lines.at(-1)?.slice(0, 3)), text: lines.join("\n") };
  };
}

async function expectCode(reply: () => Promise<{ code: number }>, codes: number[]) {
  const result = await reply();
  if (!codes.includes(result.code)) throw new Error(`SMTP ${result.code}`);
}

async function sendSmtp(message: OutboundMail) {
  const host = process.env.SMTP_HOST ?? "";
  const port = Number(process.env.SMTP_PORT || 587);
  const implicitTls = process.env.SMTP_SECURE === "1" || port === 465;
  const fromHeader = process.env.SMTP_FROM ?? "";
  const from = mailbox(fromHeader);
  const to = mailbox(message.to);
  const user = process.env.SMTP_USER ?? "";
  const pass = process.env.SMTP_PASS ?? "";

  const opened = await new Promise<{ socket: SocketLike; reply: ReturnType<typeof readReplies> }>((resolve, reject) => {
    const socket = implicitTls ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    const reply = readReplies(socket);
    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(12_000, () => fail(new Error("SMTP timed out")));
    socket.once("error", fail);
    socket.once(implicitTls ? "secureConnect" : "connect", () => resolve({ socket, reply }));
  });

  let { socket, reply } = opened;
  const command = async (value: string, codes: number[]) => {
    socket.write(`${value}\r\n`);
    await expectCode(reply, codes);
  };

  try {
    await expectCode(reply, [220]);
    await command("EHLO outklas", [250]);
    if (!implicitTls) {
      await command("STARTTLS", [220]);
      socket.removeAllListeners("data");
      socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
        const secure = tls.connect({ socket, servername: host }, () => resolve(secure));
        secure.once("error", reject);
      });
      reply = readReplies(socket);
      await command("EHLO outklas", [250]);
    }
    if (user) {
      await command("AUTH LOGIN", [334]);
      await command(Buffer.from(user).toString("base64"), [334]);
      await command(Buffer.from(pass).toString("base64"), [235]);
    }
    await command(`MAIL FROM:<${from}>`, [250]);
    await command(`RCPT TO:<${to}>`, [250, 251]);
    await command("DATA", [354]);
    socket.write(`${smtpData({ from: fromHeader, to: message.to, subject: message.subject, body: message.body })}\r\n.\r\n`);
    await expectCode(reply, [250]);
    socket.write("QUIT\r\n");
  } finally {
    socket.end();
  }
}

/** Always stores the message. Delivers it over SMTP only when SMTP_HOST and SMTP_FROM are set. */
export async function deliverMail(db: Db, message: OutboundMail): Promise<{ delivered: boolean; transport: "smtp" | "internal"; error?: string }> {
  let delivered = false;
  let error: string | undefined;
  if (smtpConfigured()) {
    try {
      await sendSmtp(message);
      delivered = true;
    } catch (caught) {
      error = caught instanceof Error ? caught.message.slice(0, 300) : "SMTP failed";
    }
  } else if (process.env.NODE_ENV === "production") {
    console.warn("Auth mail stayed in auth_mail because SMTP_HOST and SMTP_FROM are unset.");
  }
  await db.insert(authMail).values({
    id: randomUUID(),
    toEmail: message.to,
    purpose: message.purpose,
    subject: message.subject,
    body: message.body,
    deliveredAt: delivered ? new Date() : null,
    error: error ?? null,
  });
  return { delivered, transport: smtpConfigured() ? "smtp" : "internal", error };
}
