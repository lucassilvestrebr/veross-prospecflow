# Veross ProspecFlow

Primeira versão operacional da plataforma de Sales Engagement da Veross.

## Stack

- Next.js + TypeScript
- Neon Auth + Neon Serverless Postgres
- Vercel
- Cloudinary para os ativos de marca

## Configuração

1. Crie um projeto gratuito no Neon e habilite o Neon Auth.
2. Execute os arquivos de `neon/migrations` em ordem no SQL Editor do Neon.
3. Copie `.env.example` para `.env.local` e preencha `DATABASE_URL`, `NEON_AUTH_BASE_URL` e `NEON_AUTH_COOKIE_SECRET`.
4. Execute `npm install` e `npm run dev`.

Sem as variáveis do Neon, a aplicação abre em modo demonstrativo com dados locais temporários.

## Trial

Cada organização nasce com 23 dias de trial e exclusão programada para o 30º dia. Agende diariamente a função `cleanup_expired_trial_accounts()` em um Vercel Cron protegido. Antes de produção, conecte o webhook do provedor de pagamento para alterar `organizations.plan_status` para `active`, `past_due` ou `cancelled`.

## Deploy

Conecte o repositório à Vercel pela integração oficial do Neon, configure as três variáveis de ambiente e adicione o domínio. Cadastre as URLs de produção e desenvolvimento em Auth > Domains no Neon.

## Pagamentos com Stripe

O checkout está preparado para cobrança mensal por acesso. Configure na Vercel:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_1_USER` — R$ 197 por acesso
- `STRIPE_PRICE_2_USERS` — R$ 147 por acesso, quantidade 2
- `STRIPE_PRICE_3_USERS` — R$ 97 por acesso, quantidade 3

Cadastre o endpoint `/api/billing/webhook` na Stripe para os eventos `customer.subscription.created`, `customer.subscription.updated` e `customer.subscription.deleted`.

## Próximas integrações recomendadas

- Resend para confirmação, recuperação de senha e avisos do trial.
- Stripe Customer Portal para troca de plano, cartão e cancelamento pelo cliente.
- Sentry para erros.
- Trigger.dev para gerar e executar tarefas programadas quando as cadências automáticas entrarem.
