export interface EmailAttachment {
  filename: string;
  content: string;
}

export interface SendEmailOptions {
  user: string;
  password: string;
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  fromName?: string;
  attachments?: EmailAttachment[];
}

export async function sendViaGmailSmtp(opts: SendEmailOptions): Promise<{ ok: boolean; error?: string }> {
  if (!opts.user || !opts.password) return { ok: false, error: "Faltan las credenciales de Gmail." };
  if (opts.to.length === 0) return { ok: false, error: "Falta el correo destinatario." };

  let conn: Deno.Conn;
  try {
    conn = await Deno.connect({ hostname: "smtp.gmail.com", port: 587 });
  } catch {
    return { ok: false, error: "No se pudo conectar con Gmail SMTP." };
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    const readResponse = async (): Promise<string> => {
      let response = "";
      while (true) {
        while (!buffer.includes("\r\n")) {
          const chunk = new Uint8Array(1024);
          const size = await conn.read(chunk);
          if (size === null) return response;
          buffer += decoder.decode(chunk.subarray(0, size));
        }
        const end = buffer.indexOf("\r\n");
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        response += `${line}\n`;
        if (line.length < 4 || line[3] !== "-") return response;
      }
    };
    const send = async (command: string): Promise<void> => {
      const data = encoder.encode(`${command}\r\n`);
      let offset = 0;
      while (offset < data.length) {
        const written = await conn.write(data.subarray(offset));
        if (written <= 0) throw new Error('SMTP connection closed while sending data');
        offset += written;
      }
    };

    if (!(await readResponse()).startsWith("220")) return { ok: false, error: "Gmail no respondió." };
    await send("EHLO localhost");
    if (!(await readResponse()).startsWith("250")) return { ok: false, error: "Gmail rechazó el saludo." };
    await send("STARTTLS");
    if (!(await readResponse()).startsWith("220")) return { ok: false, error: "TLS no disponible." };
    conn = await Deno.startTls(conn, { hostname: "smtp.gmail.com" });
    await send("EHLO localhost");
    if (!(await readResponse()).startsWith("250")) return { ok: false, error: "TLS falló." };
    await send("AUTH LOGIN");
    if (!(await readResponse()).startsWith("334")) return { ok: false, error: "AUTH LOGIN rechazado." };
    await send(btoa(opts.user));
    if (!(await readResponse()).startsWith("334")) return { ok: false, error: "Usuario rechazado." };
    await send(btoa(opts.password));
    if (!(await readResponse()).startsWith("235")) return { ok: false, error: "Contraseña de aplicación incorrecta." };

    await send(`MAIL FROM:<${opts.user}>`);
    if (!(await readResponse()).startsWith("250")) return { ok: false, error: "Remitente rechazado." };

    for (const addr of opts.to) {
      await send(`RCPT TO:<${addr}>`);
      if (!(await readResponse()).startsWith("250")) return { ok: false, error: `Destinatario rechazado: ${addr}` };
    }
    for (const addr of opts.cc ?? []) {
      await send(`RCPT TO:<${addr}>`);
      if (!(await readResponse()).startsWith("250")) return { ok: false, error: `Copia rechazada: ${addr}` };
    }

    await send("DATA");
    if (!(await readResponse()).startsWith("354")) return { ok: false, error: "DATA rechazado." };

    const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const fromName = opts.fromName ?? opts.user;
    const hasAttachments = (opts.attachments ?? []).length > 0;

    let message: string;
    if (hasAttachments) {
      const headers = [
        `From: ${fromName} <${opts.user}>`,
        `To: ${opts.to.join(", ")}`,
        ...(opts.cc && opts.cc.length > 0 ? [`Cc: ${opts.cc.join(", ")}`] : []),
        `Subject: ${encodeSubject(opts.subject)}`,
        "MIME-Version: 1.0",
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        "",
      ];
      const bodyParts = [
        `--${boundary}`,
        "Content-Type: text/html; charset=UTF-8",
        "Content-Transfer-Encoding: 7bit",
        "",
        opts.html,
        "",
      ];
      for (const att of opts.attachments ?? []) {
        bodyParts.push(
          `--${boundary}`,
          `Content-Type: application/octet-stream; name="${att.filename}"`,
          "Content-Transfer-Encoding: base64",
          `Content-Disposition: attachment; filename="${att.filename}"`,
          "",
          att.content,
          "",
        );
      }
      bodyParts.push(`--${boundary}--`);
      message = [...headers, ...bodyParts].join("\r\n");
    } else {
      message = [
        `From: ${fromName} <${opts.user}>`,
        `To: ${opts.to.join(", ")}`,
        ...(opts.cc && opts.cc.length > 0 ? [`Cc: ${opts.cc.join(", ")}`] : []),
        `Subject: ${encodeSubject(opts.subject)}`,
        "MIME-Version: 1.0",
        "Content-Type: text/html; charset=UTF-8",
        "",
        opts.html,
      ].join("\r\n");
    }

    await send(message);
    const dataResponse = await readResponse();
    if (!dataResponse.startsWith("250")) return { ok: false, error: "Gmail rechazó el envío." };
    return { ok: true };
  } catch (error) {
    console.error("Gmail SMTP failed", error);
    return { ok: false, error: "Error de conexión con Gmail." };
  } finally {
    try { conn.close(); } catch { /* ignore */ }
  }
}

export function parseRecipients(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item));
}

function encodeSubject(subject: string): string {
  const needsEncoding = /[^\x00-\x7F]/.test(subject);
  if (!needsEncoding) return subject;
  return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;
}
