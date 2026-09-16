import { createHash, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ key: string }> };
type AlessiaPayload = Record<string, unknown>;

const clean = (value: unknown) => {
  const text = String(value ?? "").trim();
  return ["", "unavailable", "n/a", "null", "undefined", "none", "not available"].includes(text.toLowerCase()) ? "" : text;
};
const secretHash = (value: string) => createHash("sha256").update(value).digest("hex");
const secretMatches = (provided: string, stored: string) => {
  const a = Buffer.from(secretHash(provided));
  const b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
};
const splitName = (payload: AlessiaPayload) => {
  const first = clean(payload.firstName);
  const last = clean(payload.lastName);
  if (first) return { first, last };
  const parts = clean(payload.fullName).split(/\s+/).filter(Boolean);
  return { first: parts.shift() || "Contato", last: parts.join(" ") };
};
function scheduledDate(dayOffset: number, time: string, workDays: number[]) {
  const date = new Date();
  date.setDate(date.getDate() + Math.max(0, dayOffset));
  while (!workDays.includes(date.getDay())) date.setDate(date.getDate() + 1);
  const [hour, minute] = time.split(":").map(Number);
  date.setHours(hour || 9, minute || 0, 0, 0);
  return date.toISOString();
}

export async function POST(request: NextRequest, { params }: Params) {
  const sql = getDb();
  const { key } = await params;
  let payload: AlessiaPayload = {};
  const integrationRows = await sql`select id,organization_id,cadence_id,assigned_to,secret_hash,active from webhook_integrations where webhook_key::text=${key} and provider='alessia_flow' limit 1`;
  const integration = integrationRows[0] as Record<string, string | boolean> | undefined;
  if (!integration) return NextResponse.json({ error: "Webhook não encontrado." }, { status: 404 });
  try {
    payload = await request.json() as AlessiaPayload;
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }
  const provided = request.headers.get("x-prospecflow-secret") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!provided || !secretMatches(provided, String(integration.secret_hash))) {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }
  if (!integration.active) return NextResponse.json({ error: "Integração inativa." }, { status: 409 });

  const externalReference = clean(payload.uniqueId) || null;
  const recordEvent = async (status: "created" | "duplicate" | "rejected" | "failed", message: string, leadId: string | null = null) => {
    await sql`insert into webhook_events (integration_id,external_reference,status,message,lead_id,payload) values (${String(integration.id)},${externalReference},${status},${message},${leadId},${JSON.stringify(payload)}) on conflict (integration_id,external_reference) where external_reference is not null do nothing`;
  };
  try {
    if (externalReference) {
      const previous = await sql`select status,lead_id from webhook_events where integration_id=${String(integration.id)} and external_reference=${externalReference} limit 1`;
      if (previous[0]) return NextResponse.json({ ok: true, status: "duplicate", leadId: previous[0].lead_id, message: "Evento já processado." });
    }
    const email = [payload.emailId, payload.providedEmailId, payload.customEmailId, payload.linkedInAccountEmailId].map(clean).find(Boolean)?.toLowerCase() || "";
    const company = clean(payload.companyName);
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      await recordEvent("rejected", "E-mail válido não informado.");
      return NextResponse.json({ ok: false, status: "rejected", error: "E-mail válido é obrigatório." }, { status: 422 });
    }
    if (!company) {
      await recordEvent("rejected", "Empresa não informada.");
      return NextResponse.json({ ok: false, status: "rejected", error: "Empresa é obrigatória." }, { status: 422 });
    }
    const existing = await sql`select id from leads where organization_id=${String(integration.organization_id)} and lower(trim(email))=${email} limit 1`;
    if (existing[0]) {
      await recordEvent("duplicate", "Já existe um lead com este e-mail na organização.", String(existing[0].id));
      return NextResponse.json({ ok: true, status: "duplicate", leadId: existing[0].id });
    }
    const { first, last } = splitName(payload);
    const customData: Record<string, string> = {
      LinkedIn: clean(payload.linkedinProfile),
      "LinkedIn da empresa": clean(payload.companyLinkedinPage),
      Site: clean(payload.companyWebsiteFromCompanyProfile) || clean(payload.companyWebsiteFromPersonalProfile),
      Segmento: clean(payload.industry),
      Cidade: clean(payload.city),
      Estado: clean(payload.state),
      Campanha: clean(payload.campaignName),
      "ID externo AlessIA": externalReference || "",
    };
    for (const [name, value] of Object.entries(payload.customColumns as Record<string, unknown> || {})) customData[name] = clean(value);
    const observations = clean(payload.leadContext) || clean(payload.annotations);
    const settings = await sql`select work_days,blocklist,score_rules_v2 from organization_settings where organization_id=${String(integration.organization_id)} limit 1`;
    const blocklist = ((settings[0]?.blocklist as string[]) || []).map(item => item.toLowerCase().trim()).filter(Boolean);
    if (blocklist.some(item => `${email} ${clean(payload.phoneNumber)}`.toLowerCase().includes(item))) {
      await recordEvent("rejected", "Lead bloqueado pela blocklist.");
      return NextResponse.json({ ok: false, status: "rejected", error: "Lead bloqueado." }, { status: 422 });
    }
    const score = 50;
    const lead = await sql`insert into leads (organization_id,created_by,first_name,last_name,email,phone,company,job_title,score,status,source,custom_data,observations) values (${String(integration.organization_id)},${String(integration.assigned_to)},${first},${last},${email},${clean(payload.phoneNumber)||null},${company},${clean(payload.jobTitle)||null},${score},'new','AlessIA Flow',${JSON.stringify(customData)},${observations||null}) returning id`;
    const steps = await sql`select s.id,s.step_order,s.day_offset,s.type,s.title,s.instructions,s.suggested_time::text,s.template_id,t.email_subject,t.email_body from cadence_steps s left join activity_templates t on t.id=s.template_id where s.cadence_id=${String(integration.cadence_id)} order by s.step_order`;
    if (!steps.length) throw new Error("A cadência configurada não possui atividades.");
    const workDays = (settings[0]?.work_days as number[] | undefined) || [1, 2, 3, 4, 5];
    await sql`insert into lead_cadences (lead_id,cadence_id,status,current_step,started_at) values (${String(lead[0].id)},${String(integration.cadence_id)},'active',1,now())`;
    for (const step of steps) await sql`insert into activities (lead_id,cadence_step_id,activity_template_id,assigned_to,type,title,status,due_at,notes,email_subject,email_body) values (${String(lead[0].id)},${step.id},${step.template_id||null},${String(integration.assigned_to)},${String(step.type)},${String(step.title)},'pending',${scheduledDate(Number(step.day_offset),String(step.suggested_time||"09:00"),workDays)},${String(step.instructions||"")},${step.email_subject||null},${step.email_body||null})`;
    await sql`update leads set status='prospecting',updated_at=now() where id=${String(lead[0].id)}`;
    await sql`insert into lead_events (lead_id,actor_id,event_type,title,body,metadata) values (${String(lead[0].id)},${String(integration.assigned_to)},'webhook_created','Lead criado pela AlessIA Flow','Lead incluído pela integração e cadência iniciada.',${JSON.stringify({ integrationId: integration.id, externalReference })})`;
    await recordEvent("created", "Lead criado e cadência iniciada.", String(lead[0].id));
    return NextResponse.json({ ok: true, status: "created", leadId: lead[0].id }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao processar o webhook.";
    await recordEvent("failed", message);
    return NextResponse.json({ ok: false, status: "failed", error: message }, { status: 500 });
  }
}
