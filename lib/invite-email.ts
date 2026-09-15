type InviteEmailInput = {
  to: string;
  firstName: string;
  inviterName: string;
  organizationName: string;
  role: string;
  inviteUrl: string;
};

const roleLabels: Record<string, string> = {
  admin: "Administrador",
  manager: "Gestor",
  member: "Membro",
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] || character);
}

export async function sendInviteEmail(input: InviteEmailInput) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, error: "Envio de e-mail ainda não configurado." };

  const name = escapeHtml(input.firstName || "Olá");
  const organization = escapeHtml(input.organizationName);
  const inviter = escapeHtml(input.inviterName);
  const role = escapeHtml(roleLabels[input.role] || input.role);
  const inviteUrl = escapeHtml(input.inviteUrl);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.PROSPECFLOW_INVITE_FROM || "ProspecFlow <convites@veross.com.br>",
      to: [input.to],
      subject: `${input.inviterName} convidou você para o ProspecFlow`,
      html: `<div style="font-family:Arial,sans-serif;color:#060923;line-height:1.55;max-width:600px;margin:auto;padding:32px"><h1 style="margin:0 0 18px">Você foi convidado para o ProspecFlow</h1><p>${name}, ${inviter} convidou você para participar da equipe <strong>${organization}</strong> com a função de <strong>${role}</strong>.</p><p>Use o botão abaixo para criar sua senha ou entrar com o e-mail convidado.</p><p style="margin:28px 0"><a href="${inviteUrl}" style="display:inline-block;background:#ae8a56;color:#060923;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:7px">Aceitar convite</a></p><p style="font-size:12px;color:#6d6f7c">Este convite é exclusivo para ${escapeHtml(input.to)}.</p></div>`,
    }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { message?: string };
    return { sent: false, error: result.message || "Não foi possível enviar o e-mail." };
  }
  return { sent: true };
}
