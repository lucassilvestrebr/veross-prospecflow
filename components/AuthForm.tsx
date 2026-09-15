"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

const VEROSS_LOGO = "https://res.cloudinary.com/dofv1fbu6/image/upload/v1789318847/VEROSS-LOGO-BRANCO_ig1x7c.png";
type Invitation = { email: string; first_name: string; last_name: string; role: string; organization_name: string };
const roleLabels: Record<string, string> = { admin: "Administrador", manager: "Gestor", member: "Membro" };

export default function AuthForm({ backendConfigured }: { backendConfigured: boolean }) {
  const [signup, setSignup] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("invite") || "";
    if (!token) return;
    setInviteToken(token);
    setInviteLoading(true);
    fetch(`/api/invitations/${encodeURIComponent(token)}`)
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Convite inválido.");
        setInvitation(result);
      })
      .catch(error => setMessage(error instanceof Error ? error.message : "Convite inválido."))
      .finally(() => setInviteLoading(false));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!backendConfigured) {
      setMessage("Conecte o projeto Neon para ativar o acesso real.");
      return;
    }

    const form = new FormData(event.currentTarget);
    const email = invitation?.email || String(form.get("email"));
    const password = String(form.get("password"));
    const name = `${String(form.get("first_name") || "")} ${String(form.get("last_name") || "")}`.trim();
    setLoading(true);
    setMessage("");

    try {
      const result = signup
        ? await authClient.signUp.email({ email, password, name })
        : await authClient.signIn.email({ email, password });

      if (result.error) {
        setMessage(result.error.message || "Não foi possível autenticar.");
        return;
      }

      if (signup || inviteToken) {
        const onboarding = await fetch("/api/workspace", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "onboard",
            inviteToken,
            firstName: invitation?.first_name || form.get("first_name"),
            lastName: invitation?.last_name || form.get("last_name"),
            phone: form.get("phone"),
            company: form.get("company"),
          }),
        });
        if (!onboarding.ok) {
          const onboardingResult = await onboarding.json();
          setMessage(onboardingResult.error || "Não foi possível concluir o cadastro.");
          return;
        }
      }

      router.replace("/");
      router.refresh();
    } catch {
      setMessage("Não foi possível concluir o acesso. Atualize a página e tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-brand">
        <img src={VEROSS_LOGO} alt="Veross" className="auth-logo" />
        <h1>Transforme prospecção em <em>ritmo.</em></h1>
        <p>Cadências, execução e inteligência comercial em um só lugar.</p>
      </section>
      <section className="auth-side">
        <form className="auth-card" onSubmit={submit}>
          <span className="eyebrow">{inviteToken ? "Convite para equipe" : "23 dias grátis"}</span>
          <h2>{inviteToken ? "Entre para a equipe" : signup ? "Crie sua conta" : "Acesse sua conta"}</h2>
          <p>{invitation ? `Você foi convidado para ${invitation.organization_name} como ${roleLabels[invitation.role] || invitation.role}.` : signup ? "Todas as funcionalidades durante o período de teste." : "Continue sua operação de onde parou."}</p>
          {!backendConfigured && <div className="notice">Modo de demonstração: conecte um projeto Neon para liberar o cadastro real.</div>}
          {signup && <div className="form-grid" key={invitation?.email || "signup"}>
            <label>Primeiro nome<input name="first_name" defaultValue={invitation?.first_name || ""} required /></label>
            <label>Sobrenome<input name="last_name" defaultValue={invitation?.last_name || ""} required /></label>
            <label>Telefone<input name="phone" required /></label>
            {!inviteToken && <label>Empresa<input name="company" required /></label>}
          </div>}
          <label>E-mail<input name="email" type="email" defaultValue={invitation?.email || ""} readOnly={Boolean(invitation)} required key={invitation?.email || "email"} /></label>
          <label>Senha<input name="password" type="password" minLength={8} required /></label>
          {message && <div className="form-message">{message}</div>}
          <button className="primary wide" disabled={loading || inviteLoading || Boolean(inviteToken && !invitation)}>{loading || inviteLoading ? "Aguarde…" : inviteToken ? signup ? "Aceitar convite" : "Entrar e aceitar convite" : signup ? "Criar conta e começar" : "Entrar"}</button>
          <button type="button" className="text-button" onClick={() => { setSignup(!signup); setMessage(""); }}>
            {signup ? "Já tenho uma conta" : inviteToken ? "Preciso criar minha senha" : "Quero criar uma conta"}
          </button>
        </form>
      </section>
    </main>
  );
}
