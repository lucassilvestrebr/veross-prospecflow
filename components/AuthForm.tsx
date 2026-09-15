"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

const VEROSS_LOGO = "https://res.cloudinary.com/dofv1fbu6/image/upload/v1789318847/VEROSS-LOGO-BRANCO_ig1x7c.png";

export default function AuthForm({ backendConfigured }: { backendConfigured: boolean }) {
  const [signup, setSignup] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!backendConfigured) {
      setMessage("Conecte o projeto Neon para ativar o acesso real.");
      return;
    }

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    const name = `${String(form.get("first_name") || "")} ${String(form.get("last_name") || "")}`.trim();
    setLoading(true);
    setMessage("");

    const result = signup
      ? await authClient.signUp.email({ email, password, name })
      : await authClient.signIn.email({ email, password });

    if (result.error) {
      setLoading(false);
      setMessage(result.error.message || "Não foi possível autenticar.");
      return;
    }

    if (signup) {
      await fetch("/api/workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "onboard",
          firstName: form.get("first_name"),
          lastName: form.get("last_name"),
          phone: form.get("phone"),
          company: form.get("company"),
        }),
      });
    }

    router.replace("/");
    router.refresh();
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
          <span className="eyebrow">23 dias grátis</span>
          <h2>{signup ? "Crie sua conta" : "Acesse sua conta"}</h2>
          <p>{signup ? "Todas as funcionalidades durante o período de teste." : "Continue sua operação de onde parou."}</p>
          {!backendConfigured && <div className="notice">Modo de demonstração: conecte um projeto Neon para liberar o cadastro real.</div>}
          {signup && <div className="form-grid">
            <label>Primeiro nome<input name="first_name" required /></label>
            <label>Sobrenome<input name="last_name" required /></label>
            <label>Telefone<input name="phone" required /></label>
            <label>Empresa<input name="company" required /></label>
          </div>}
          <label>E-mail<input name="email" type="email" required /></label>
          <label>Senha<input name="password" type="password" minLength={8} required /></label>
          {message && <div className="form-message">{message}</div>}
          <button className="primary wide" disabled={loading}>{loading ? "Aguarde…" : signup ? "Criar conta e começar" : "Entrar"}</button>
          <button type="button" className="text-button" onClick={() => { setSignup(!signup); setMessage(""); }}>
            {signup ? "Já tenho uma conta" : "Quero criar uma conta"}
          </button>
        </form>
      </section>
    </main>
  );
}
