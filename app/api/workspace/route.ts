import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { auth, isNeonConfigured } from "@/lib/auth-server";
import { getDb } from "@/lib/db";
import { sendInviteEmail } from "@/lib/invite-email";

export const dynamic = "force-dynamic";
type SessionUser = { id: string; name?: string | null; email?: string | null };
type StepInput = { template_id?: string | null; step_order: number; day_offset: number; type: string; title: string; instructions?: string; suggested_time?: string };
type UserProfile = { user_id:string; organization_id:string; role:string; status:string };
type PendingInvite = { id:string; organization_id:string; first_name:string; last_name:string; role:string };
type ScoreRule = { field:string; operator:"equals"|"contains"|"filled"; value:string; points:number };
const webhookSecret = () => randomBytes(24).toString("base64url");
const webhookSecretHash = (secret:string) => createHash("sha256").update(secret).digest("hex");

async function currentUser(): Promise<SessionUser | null> {
  if (!isNeonConfigured) return null;
  const { data } = await auth.getSession();
  return data?.user ? data.user as SessionUser : null;
}

async function insertStep(cadenceId: string, step: StepInput) {
  const sql = getDb();
  await sql`insert into cadence_steps (cadence_id, template_id, step_order, day_offset, type, title, instructions, suggested_time)
    values (${cadenceId}, ${step.template_id||null}, ${Number(step.step_order)}, ${Number(step.day_offset)}, ${String(step.type)}, ${String(step.title)}, ${String(step.instructions || "")}, ${String(step.suggested_time || "09:00")})`;
}

async function seedOrganization(organizationId: string) {
  const sql = getDb();
  const existing = await sql`select id from cadences where organization_id = ${organizationId} limit 1`;
  let cadenceId = existing[0]?.id as string | undefined;
  if (!cadenceId) {
    const cadence = await sql`insert into cadences (organization_id, name, description, active) values (${organizationId}, 'Prospecção padrão Veross', 'Cadência inicial pronta para uso', true) returning id`;
    cadenceId = String(cadence[0].id);
  }
  const steps = await sql`select id from cadence_steps where cadence_id = ${cadenceId} limit 1`;
  if (!steps[0]) {
    const defaults: StepInput[] = [
      {step_order:1,day_offset:0,type:"research",title:"Pesquisa e contexto",instructions:"Valide empresa, cargo e sinais de aderência.",suggested_time:"08:30"},
      {step_order:2,day_offset:0,type:"call",title:"Ligação 1 · Abertura",instructions:"Confirme contexto e responsabilidade.",suggested_time:"10:00"},
      {step_order:3,day_offset:1,type:"email",title:"E-mail 1 · Contexto",instructions:"Envie uma mensagem curta com hipótese de valor.",suggested_time:"14:00"},
      {step_order:4,day_offset:3,type:"linkedin",title:"LinkedIn · Conexão",instructions:"Interaja e envie convite personalizado.",suggested_time:"11:00"},
      {step_order:5,day_offset:5,type:"whatsapp",title:"WhatsApp · Retomada",instructions:"Use quando houver número corporativo válido.",suggested_time:"15:00"},
      {step_order:6,day_offset:8,type:"call",title:"Ligação 2 · Diagnóstico",instructions:"Explore prioridade, cenário e próximo passo.",suggested_time:"10:30"},
    ];
    for (const step of defaults) await insertStep(cadenceId, step);
  }
  await sql`insert into activity_templates (organization_id,name,type,instructions)
    select distinct c.organization_id,s.title,s.type,coalesce(s.instructions,'') from cadence_steps s join cadences c on c.id=s.cadence_id
    where c.organization_id=${organizationId} on conflict (organization_id,name) do nothing`;
  await sql`update cadence_steps s set template_id=t.id from cadences c,activity_templates t
    where c.id=s.cadence_id and c.organization_id=${organizationId} and t.organization_id=c.organization_id and t.name=s.title and t.type=s.type and s.template_id is null`;
  await sql`insert into organization_settings (organization_id) values (${organizationId}) on conflict do nothing`;
  await sql`insert into loss_reasons (organization_id, name) values (${organizationId}, 'Sem interesse'), (${organizationId}, 'Sem orçamento'), (${organizationId}, 'Timing inadequado') on conflict do nothing`;
}

async function ensureProfile(user: SessionUser) {
  const sql = getDb();
  const existing = await sql`select user_id, organization_id, role, status from profiles where user_id = ${user.id} limit 1`;
  if (existing[0]) return existing[0] as UserProfile;
  const displayName = user.name?.trim() || user.email?.split("@")[0] || "Usuário";
  const invited = user.email ? await sql`select id,organization_id,first_name,last_name,role from user_invites where lower(email)=lower(${user.email}) and status='pending' order by created_at desc limit 1` : [];
  if(invited[0]){
    return acceptInvite(user,invited[0] as PendingInvite);
  }
  const org = await sql`insert into organizations (name) values (${`Empresa de ${displayName}`}) returning id`;
  await sql`insert into profiles (user_id, organization_id, first_name, last_name, email, role) values (${user.id}, ${org[0].id}, ${displayName}, '', ${user.email || ""}, 'owner')`;
  await seedOrganization(String(org[0].id));
  return { user_id: user.id, organization_id: String(org[0].id), role:'owner', status:'active' };
}

async function acceptInvite(user:SessionUser,invite:PendingInvite,phone="") {
  const sql=getDb();const existing=await sql`select organization_id from profiles where user_id=${user.id} limit 1`;const previousOrganization=existing[0]?.organization_id?String(existing[0].organization_id):"";const displayName=user.name?.trim()||user.email?.split("@")[0]||"Usuário";
  if(existing[0])await sql`update profiles set organization_id=${invite.organization_id},first_name=${invite.first_name||displayName},last_name=${invite.last_name||""},phone=coalesce(nullif(${phone},''),phone),email=${user.email||""},role=${invite.role},status='active',deleted_at=null,updated_at=now() where user_id=${user.id}`;
  else await sql`insert into profiles (user_id,organization_id,first_name,last_name,phone,email,role,status) values (${user.id},${invite.organization_id},${invite.first_name||displayName},${invite.last_name||""},${phone||null},${user.email||""},${invite.role},'active')`;
  await sql`update user_invites set status='accepted',accepted_at=now() where id=${invite.id} and status='pending'`;
  if(previousOrganization&&previousOrganization!==invite.organization_id){await sql`delete from organizations o where o.id=${previousOrganization} and o.plan_status='trial' and not exists(select 1 from profiles p where p.organization_id=o.id) and not exists(select 1 from leads l where l.organization_id=o.id)`;}
  return {user_id:user.id,organization_id:String(invite.organization_id),role:String(invite.role),status:'active'};
}

function inviteUrl(request:NextRequest,token:unknown){const configured=process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/,"");return `${configured||new URL(request.url).origin}/auth?invite=${encodeURIComponent(String(token))}`;}

async function calculateScore(organizationId:string, lead:Record<string,unknown>){
  const sql=getDb();const rows=await sql`select score_rules_v2 from organization_settings where organization_id=${organizationId} limit 1`;
  const rules=(rows[0]?.score_rules_v2 as ScoreRule[]|undefined)||[];const custom=(lead.custom_data||{}) as Record<string,unknown>;
  const valueFor=(field:string)=>field.startsWith('custom:')?custom[field.slice(7)]:lead[field];
  const normalized=(v:unknown)=>String(v??'').trim().toLocaleLowerCase('pt-BR');
  const score=rules.reduce((sum,rule)=>{const actual=normalized(valueFor(rule.field));const expected=normalized(rule.value);const matches=rule.operator==='filled'?Boolean(actual):rule.operator==='contains'?actual.includes(expected):actual===expected;return sum+(matches?Number(rule.points)||0:0)},0);
  return Math.max(0,Math.min(100,score));
}

function isAdmin(profile:UserProfile){return profile.role==='owner'||profile.role==='admin'}
async function requireAdmin(profile:UserProfile){if(!isAdmin(profile))throw new Error('Apenas administradores podem realizar esta ação.');}

function scheduledDate(dayOffset: number, time: string, workDays: number[]) {
  const date = new Date();
  date.setDate(date.getDate() + Math.max(0, dayOffset));
  while (!workDays.includes(date.getDay())) date.setDate(date.getDate() + 1);
  const [hour, minute] = (time || "09:00").split(":").map(Number);
  date.setHours(hour || 9, minute || 0, 0, 0);
  return date.toISOString();
}

async function attachCadence(organizationId: string, userId: string, leadId: string, cadenceId: string) {
  const sql = getDb();
  const cadence = await sql`select id from cadences where id = ${cadenceId} and organization_id = ${organizationId} and active = true limit 1`;
  if (!cadence[0]) throw new Error("Selecione uma cadência ativa.");
  const [steps, settings] = await Promise.all([
    sql`select s.id,s.step_order,s.day_offset,s.type,s.title,s.instructions,s.suggested_time::text,s.template_id,t.email_subject,t.email_body from cadence_steps s left join activity_templates t on t.id=s.template_id where s.cadence_id = ${cadenceId} order by s.step_order`,
    sql`select work_days from organization_settings where organization_id = ${organizationId} limit 1`,
  ]);
  if (!steps.length) throw new Error("A cadência selecionada não possui etapas.");
  await sql`update lead_cadences set status = 'stopped' where lead_id = ${leadId} and status in ('active','paused')`;
  await sql`insert into lead_cadences (lead_id, cadence_id, status, current_step, started_at) values (${leadId}, ${cadenceId}, 'active', 1, now())
    on conflict (lead_id, cadence_id) do update set status='active', current_step=1, started_at=now()`;
  const days = (settings[0]?.work_days as number[] | undefined) || [1,2,3,4,5];
  for (const step of steps) {
    await sql`insert into activities (lead_id, cadence_step_id, activity_template_id, assigned_to, type, title, status, due_at, notes, email_subject, email_body)
      values (${leadId}, ${step.id}, ${step.template_id||null}, ${userId}, ${String(step.type)}, ${String(step.title)}, 'pending', ${scheduledDate(Number(step.day_offset), String(step.suggested_time), days)}, ${String(step.instructions || "")}, ${step.email_subject||null}, ${step.email_body||null})`;
  }
  await sql`update leads set status='prospecting', updated_at=now() where id=${leadId}`;
  await sql`insert into lead_events (lead_id, actor_id, event_type, title, body) values (${leadId}, ${userId}, 'cadence_started', 'Cadência iniciada', 'As atividades da cadência foram geradas.')`;
}

async function assertNotBlocked(organizationId:string,email:string,phone:string){
  const sql=getDb();const rows=await sql`select blocklist from organization_settings where organization_id=${organizationId} limit 1`;
  const blocked=((rows[0]?.blocklist as string[])||[]).map(x=>x.toLowerCase().trim()).filter(Boolean);const target=`${email} ${phone}`.toLowerCase();
  if(blocked.some(item=>target.includes(item)))throw new Error("Este contato está na blocklist.");
}

async function applyAutomaticLosses(organizationId:string){
  const sql=getDb();const rows=await sql`select lc.lead_id,c.automatic_loss_reason_id from lead_cadences lc join cadences c on c.id=lc.cadence_id join leads l on l.id=lc.lead_id where l.organization_id=${organizationId} and lc.status='completed' and l.status not in ('won','lost','archived') and c.automatic_loss_days>0 and c.automatic_loss_reason_id is not null and lc.completed_at is not null and lc.completed_at + make_interval(days=>c.automatic_loss_days)<=now()`;
  for(const row of rows){await sql`update leads set status='lost',lost_at=now(),loss_reason_id=${row.automatic_loss_reason_id},updated_at=now() where id=${row.lead_id}`;await sql`insert into lead_events (lead_id,event_type,title,body) values (${row.lead_id},'automatic_loss','Lead marcado como perdido','Perda automática por inatividade após a conclusão da cadência.')`;}
}

async function workspace(organizationId: string, userId?:string) {
  const sql = getDb();
  await applyAutomaticLosses(organizationId);
  const [organizations, leads, activities, cadences, activityTemplates, lossReasons, settings, profiles, events, invites, currentProfiles, feedbackRequests, leadImports] = await Promise.all([
    sql`select id, name, plan_status, trial_ends_at, delete_scheduled_at, created_at, licensed_seats from organizations where id=${organizationId} limit 1`,
    sql`select l.id,l.created_by,l.first_name,l.last_name,l.email,l.phone,l.company,l.job_title,l.score,l.status,l.source,l.created_at,l.won_at,l.lost_at,l.loss_reason_id,l.custom_data,l.observations,
      lc.cadence_id,c.name as cadence_name,lc.status as cadence_status
      from leads l left join lateral (select * from lead_cadences x where x.lead_id=l.id order by x.started_at desc limit 1) lc on true
      left join cadences c on c.id=lc.cadence_id where l.organization_id=${organizationId} order by (l.status='archived'),l.score desc,l.created_at desc`,
    sql`select a.id,a.lead_id,a.assigned_to,a.type,a.title,a.status,a.due_at,a.completed_at,a.updated_at,a.notes,a.email_subject,a.email_body,s.step_order as cadence_step_order from activities a join leads l on l.id=a.lead_id left join cadence_steps s on s.id=a.cadence_step_id where l.organization_id=${organizationId} order by a.due_at`,
    sql`select c.id,c.name,c.description,c.active,c.focus,c.priority,c.automatic_loss_days,c.automatic_loss_reason_id,
      (select count(*)::int from lead_cadences lc where lc.cadence_id=c.id) as total_leads,
      (select count(*)::int from lead_cadences lc join leads l on l.id=lc.lead_id where lc.cadence_id=c.id and l.status='new') as awaiting_start,
      (select count(*)::int from lead_cadences lc join leads l on l.id=lc.lead_id where lc.cadence_id=c.id and lc.status in ('active','paused') and l.status not in ('won','lost','archived')) as in_execution,
      (select count(*)::int from lead_cadences lc where lc.cadence_id=c.id and lc.status in ('completed','stopped')) as finished,
      (select count(*)::int from lead_cadences lc join leads l on l.id=lc.lead_id where lc.cadence_id=c.id and l.status='won') as gains,
      coalesce(json_agg(json_build_object('id',s.id,'template_id',s.template_id,'step_order',s.step_order,'day_offset',s.day_offset,'type',s.type,'title',s.title,'instructions',s.instructions,'suggested_time',to_char(s.suggested_time,'HH24:MI')) order by s.step_order) filter (where s.id is not null),'[]') as steps from cadences c left join cadence_steps s on s.cadence_id=c.id where c.organization_id=${organizationId} group by c.id order by c.active desc,c.name`,
    sql`select id,name,type,instructions,email_subject,email_body,active from activity_templates where organization_id=${organizationId} order by active desc,type,name`,
    sql`select id,name,active from loss_reasons where organization_id=${organizationId} order by active desc,name`,
    sql`select weekly_goal,daily_activity_goal,conversion_goal_pct::float,meeting_goal,monthly_gain_goal,work_days,to_char(work_start,'HH24:MI') work_start,to_char(work_end,'HH24:MI') work_end,custom_fields,score_rules,score_rules_v2,feedback_prompt,blocklist,default_role,email_sender_name,email_reply_to,role_permissions from organization_settings where organization_id=${organizationId} limit 1`,
    sql`select user_id,first_name,last_name,email,phone,role,status from profiles where organization_id=${organizationId} and status<>'deleted' order by role,first_name`,
    sql`select e.id,e.lead_id,e.event_type,e.title,e.body,e.created_at from lead_events e join leads l on l.id=e.lead_id where l.organization_id=${organizationId} order by e.created_at desc limit 500`,
    sql`select id,email,first_name,last_name,role,status,token,created_at from user_invites where organization_id=${organizationId} and status='pending' order by created_at desc`,
    userId?sql`select user_id,first_name,last_name,email,phone,role,status from profiles where user_id=${userId} limit 1`:Promise.resolve([]),
    sql`select fr.id,fr.lead_id,fr.token::text,fr.status,fr.created_at,fr.responded_at,
      concat_ws(' ',l.first_name,l.last_name) as lead_name,l.company,c.name as cadence_name,
      nullif(trim(concat_ws(' ',p.first_name,p.last_name)),'') as owner_name,
      r.had_meeting,r.meeting_date,r.accepted_as_client,r.priority_now,r.has_pain,r.has_budget,r.spoke_to_decision_maker,r.observation
      from feedback_requests fr join leads l on l.id=fr.lead_id
      left join profiles p on p.user_id=l.created_by
      left join lateral (select cadence_id from lead_cadences x where x.lead_id=l.id order by x.started_at desc limit 1) lc on true
      left join cadences c on c.id=lc.cadence_id left join feedback_responses r on r.request_id=fr.id
      where fr.organization_id=${organizationId} order by fr.created_at desc`,
    sql`select li.id,li.file_name,li.total_rows,li.accepted_rows,li.rejected_rows,li.created_at,c.name as cadence_name,
      nullif(trim(concat_ws(' ',responsible.first_name,responsible.last_name)),'') as responsible_name,
      nullif(trim(concat_ws(' ',uploader.first_name,uploader.last_name)),'') as uploader_name,
      coalesce((select json_agg(json_build_object('id',lir.id,'row_number',lir.row_number,'email',lir.email,'status',lir.status,'reason',lir.reason,'lead_id',lir.lead_id) order by lir.row_number) from lead_import_rows lir where lir.import_id=li.id),'[]') as rows
      from lead_imports li left join cadences c on c.id=li.cadence_id
      left join profiles responsible on responsible.user_id=li.assigned_to
      left join profiles uploader on uploader.user_id=li.uploaded_by
      where li.organization_id=${organizationId} order by li.created_at desc limit 100`,
  ]);
  const integrations=await sql`select wi.id,wi.provider,wi.name,wi.cadence_id,wi.assigned_to,wi.webhook_key::text,wi.active,wi.created_at,wi.updated_at,c.name as cadence_name,nullif(trim(concat_ws(' ',p.first_name,p.last_name)),'') as responsible_name,(select count(*)::int from webhook_events we where we.integration_id=wi.id) as event_count,(select count(*)::int from webhook_events we where we.integration_id=wi.id and we.status='created') as created_count,(select max(received_at) from webhook_events we where we.integration_id=wi.id) as last_received_at from webhook_integrations wi join cadences c on c.id=wi.cadence_id join profiles p on p.user_id=wi.assigned_to where wi.organization_id=${organizationId} order by wi.created_at desc`;
  const current=currentProfiles[0] as Record<string,unknown>|undefined;const role=String(current?.role||'member');const permissionConfig=(settings[0]?.role_permissions as Record<string,Record<string,boolean>>|undefined)||{};const canViewAll=role==='owner'||permissionConfig[role]?.view_all_leads!==false;
  const visibleLeads=canViewAll?leads:leads.filter((lead:Record<string,unknown>)=>lead.created_by===userId);const visibleIds=new Set(visibleLeads.map((lead:Record<string,unknown>)=>lead.id));const visibleActivities=canViewAll?activities:activities.filter((activity:Record<string,unknown>)=>visibleIds.has(activity.lead_id));const visibleEvents=canViewAll?events:events.filter((event:Record<string,unknown>)=>visibleIds.has(event.lead_id));
  const visibleFeedback=canViewAll?feedbackRequests:feedbackRequests.filter((item:Record<string,unknown>)=>visibleIds.has(item.lead_id));
  return {organization:organizations[0]||null,leads:visibleLeads,activities:visibleActivities,cadences,activityTemplates,lossReasons,settings:settings[0]||null,profiles,events:visibleEvents,invites,currentProfile:current||null,feedbackRequests:visibleFeedback,leadImports,integrations};
}

async function hasPermission(profile:UserProfile,key:string){if(profile.role==='owner')return true;const sql=getDb();const rows=await sql`select role_permissions from organization_settings where organization_id=${profile.organization_id} limit 1`;const config=(rows[0]?.role_permissions as Record<string,Record<string,boolean>>|undefined)||{};return config[profile.role]?.[key]===true;}

export async function GET() {
  const user=await currentUser(); if(!user)return NextResponse.json({error:"Não autorizado"},{status:401});
  const profile=await ensureProfile(user);if(profile.status!=='active')return NextResponse.json({error:'Usuário suspenso ou removido.'},{status:403});await seedOrganization(profile.organization_id);
  return NextResponse.json(await workspace(profile.organization_id,user.id));
}

export async function POST(request: NextRequest) {
  try {
    const user=await currentUser(); if(!user)return NextResponse.json({error:"Não autorizado"},{status:401});
    const body=await request.json(); const sql=getDb();
    if(body.action==="onboard"){
      const email=String(user.email||"").trim().toLowerCase();const token=String(body.inviteToken||"");
      const invited=token?await sql`select id,organization_id,first_name,last_name,role from user_invites where token::text=${token} and lower(email)=${email} and status='pending' limit 1`:email?await sql`select id,organization_id,first_name,last_name,role from user_invites where lower(email)=${email} and status='pending' order by created_at desc limit 1`:[];
      if(token&&!invited[0])throw new Error("Este convite não pertence ao e-mail informado ou já foi utilizado.");
      if(invited[0]){await acceptInvite(user,invited[0] as PendingInvite,String(body.phone||""));await seedOrganization(String(invited[0].organization_id));return NextResponse.json({ok:true,invited:true});}
      const existing=await sql`select organization_id from profiles where user_id=${user.id} limit 1`;
      if(existing[0]){await sql`update profiles set first_name=${String(body.firstName||"")},last_name=${String(body.lastName||"")},phone=${String(body.phone||"")},updated_at=now() where user_id=${user.id}`;const owner=await sql`select 1 from profiles where user_id=${user.id} and role='owner' limit 1`;if(owner[0]&&body.company)await sql`update organizations set name=${String(body.company)} where id=${existing[0].organization_id}`;await seedOrganization(String(existing[0].organization_id));return NextResponse.json({ok:true});}
      const org=await sql`insert into organizations (name) values (${String(body.company||"Minha empresa")}) returning id`;
      await sql`insert into profiles (user_id,organization_id,first_name,last_name,phone,email,role) values (${user.id},${org[0].id},${String(body.firstName||"")},${String(body.lastName||"")},${String(body.phone||"")},${user.email||""},'owner')`;
      await seedOrganization(String(org[0].id)); return NextResponse.json({ok:true});
    }
    const profile=await ensureProfile(user);if(profile.status!=='active')return NextResponse.json({error:'Usuário suspenso ou removido.'},{status:403});const organizationId=profile.organization_id;
    const guarded:Record<string,string>={createLead:'create_leads',bulkCreateLeads:'import_leads',deleteLead:'delete_leads',bulkDeleteLeads:'delete_leads',changeLeadOwner:'reassign_leads',createCadence:'manage_cadences',updateCadence:'manage_cadences',toggleCadence:'manage_cadences',createActivityTemplate:'manage_cadences',updateActivityTemplate:'manage_cadences',toggleActivityTemplate:'manage_cadences',createWebhookIntegration:'manage_cadences',updateWebhookIntegration:'manage_cadences',toggleWebhookIntegration:'manage_cadences',regenerateWebhookSecret:'manage_cadences',deleteWebhookIntegration:'manage_cadences'};const needed=guarded[String(body.action)];if(needed&&!await hasPermission(profile,needed))return NextResponse.json({error:'Sua função não possui permissão para esta ação.'},{status:403});
    if(body.action==="createLead"){
      if(!body.cadenceId)throw new Error("Selecione uma cadência.");
      const l=body.lead,email=String(l.email||"").trim().toLowerCase();if(!/^\S+@\S+\.\S+$/.test(email))throw new Error("Informe um e-mail válido.");const duplicate=await sql`select id from leads where organization_id=${organizationId} and lower(trim(email))=${email} limit 1`;if(duplicate[0])throw new Error("Já existe um lead com este e-mail na conta.");await assertNotBlocked(organizationId,email,String(l.phone||""));const score=await calculateScore(organizationId,{...l,email}); const rows=await sql`insert into leads (organization_id,created_by,first_name,last_name,email,phone,company,job_title,score,status,source,custom_data) values (${organizationId},${user.id},${String(l.first_name)},${String(l.last_name||"")},${email},${String(l.phone||"")},${String(l.company)},${String(l.job_title||"")},${score},'new',${String(l.source||"Manual")},${JSON.stringify(l.custom_data||{})}) returning id`;
      await attachCadence(organizationId,user.id,String(rows[0].id),String(body.cadenceId)); return NextResponse.json({data:(await workspace(organizationId,user.id)).leads.find((x:Record<string,unknown>)=>x.id===rows[0].id)});
    }
    if(body.action==="bulkCreateLeads"){
      if(!body.cadenceId)throw new Error("Selecione uma cadência.");if(!body.assignedTo)throw new Error("Selecione o responsável pela lista.");
      const assignees=await sql`select user_id from profiles where user_id=${String(body.assignedTo)} and organization_id=${organizationId} and status='active' limit 1`;if(!assignees[0])throw new Error("Selecione um responsável ativo do time.");
      const input=Array.isArray(body.leads)?body.leads:[],batchRows=await sql`insert into lead_imports (organization_id,uploaded_by,assigned_to,cadence_id,file_name,total_rows) values (${organizationId},${user.id},${String(body.assignedTo)},${String(body.cadenceId)},${String(body.fileName||"lista.csv")},${input.length}) returning id`;const importId=String(batchRows[0].id);
      let created=0;const errors:string[]=[];
      for(const [index,raw] of input.entries()){const l=raw as Record<string,unknown>;const email=String(l.email||"").trim().toLowerCase();let reason="";let leadId:string|null=null;try{if(!email||!/^\S+@\S+\.\S+$/.test(email))throw new Error("E-mail ausente ou inválido");if(!String(l.first_name||"").trim())throw new Error("Nome ausente");if(!String(l.company||"").trim())throw new Error("Empresa ausente");const duplicate=await sql`select id from leads where organization_id=${organizationId} and lower(trim(email))=${email} limit 1`;if(duplicate[0])throw new Error("Lead repetido: e-mail já cadastrado");await assertNotBlocked(organizationId,email,String(l.phone||""));const normalizedLead={...l,email};const score=await calculateScore(organizationId,normalizedLead);const rows=await sql`insert into leads (organization_id,created_by,first_name,last_name,email,phone,company,job_title,score,status,source,custom_data) values (${organizationId},${String(body.assignedTo)},${String(l.first_name).trim()},${String(l.last_name||"").trim()},${email},${String(l.phone||"")},${String(l.company).trim()},${String(l.job_title||"")},${score},'new',${String(l.source||"Importação")},${JSON.stringify(l.custom_data||{})}) returning id`;leadId=String(rows[0].id);await attachCadence(organizationId,String(body.assignedTo),leadId,String(body.cadenceId));created++;}catch(error){reason=error instanceof Error?error.message:"Erro ao importar";errors.push(`Linha ${index+2}: ${reason}`)}await sql`insert into lead_import_rows (import_id,row_number,email,status,reason,lead_id,payload) values (${importId},${index+2},${email||null},${leadId?'accepted':'rejected'},${reason||null},${leadId},${JSON.stringify(l)})`}
      await sql`update lead_imports set accepted_rows=${created},rejected_rows=${input.length-created} where id=${importId}`;
      return NextResponse.json({created,rejected:input.length-created,errors,importId});
    }
    if(body.action==="createActivity"){
      const a=body.activity;if(String(a.type)==="meeting")throw new Error("Reunião não é um tipo de atividade disponível.");const rows=await sql`insert into activities (lead_id,assigned_to,type,title,status,due_at,notes) select id,${user.id},${String(a.type)},${String(a.title)},'pending',${String(a.due_at)},${String(a.notes||"")} from leads where id=${String(a.lead_id)} and organization_id=${organizationId} returning id,lead_id,type,title,status,due_at,completed_at,notes`;
      if(!rows[0])return NextResponse.json({error:"Lead não encontrado"},{status:404});await sql`insert into lead_events (lead_id,actor_id,event_type,title,body) values (${String(a.lead_id)},${user.id},'activity_added','Atividade adicionada',${String(a.title)})`;return NextResponse.json({data:rows[0]});
    }
    if(["completeActivity","skipActivity","cancelActivity"].includes(body.action)){
      if(body.action==="skipActivity"&&!String(body.notes||"").trim())throw new Error("Informe a justificativa para ignorar a atividade.");
      const status=body.action==="completeActivity"?"completed":body.action==="skipActivity"?"skipped":"cancelled";
      const rows=await sql`update activities a set status=${status},completed_at=${status==="completed"||status==="skipped"?new Date().toISOString():null},notes=${String(body.notes||"")},updated_at=now() where a.id=${String(body.id)} and exists(select 1 from leads l where l.id=a.lead_id and l.organization_id=${organizationId}) returning id,lead_id,type,title,status,due_at,completed_at,updated_at,notes`;
      if(!rows[0])return NextResponse.json({error:"Atividade não encontrada"},{status:404});await sql`insert into lead_events (lead_id,actor_id,event_type,title,body) values (${rows[0].lead_id},${user.id},${status},${status==="completed"?"Atividade concluída":status==="skipped"?"Atividade ignorada":"Atividade cancelada"},${String(body.notes||rows[0].title)})`;const cadenceRows=await sql`update lead_cadences set status='completed',completed_at=now() where lead_id=${rows[0].lead_id} and status in ('active','paused') and not exists(select 1 from activities where lead_id=${rows[0].lead_id} and status='pending') returning id`;if(cadenceRows[0])await sql`insert into lead_events (lead_id,actor_id,event_type,title,body) values (${rows[0].lead_id},${user.id},'cadence_completed','Cadência concluída','Todos os passos da cadência foram encerrados.')`;return NextResponse.json({data:rows[0]});
    }
    if(body.action==="rescheduleActivity"){
      const rows=await sql`update activities a set due_at=${String(body.dueAt)},notes=${String(body.notes||"")},updated_at=now() where a.id=${String(body.id)} and exists(select 1 from leads l where l.id=a.lead_id and l.organization_id=${organizationId}) returning id,lead_id,type,title,status,due_at,completed_at,notes`;
      if(!rows[0])return NextResponse.json({error:"Atividade não encontrada"},{status:404});await sql`insert into lead_events (lead_id,actor_id,event_type,title,body) values (${rows[0].lead_id},${user.id},'rescheduled','Atividade reagendada',${String(body.dueAt)})`;return NextResponse.json({data:rows[0]});
    }
    if(body.action==="updateLead"){
      const l=body.lead,email=String(l.email||"").trim().toLowerCase();if(!/^\S+@\S+\.\S+$/.test(email))throw new Error("Informe um e-mail válido.");const duplicate=await sql`select id from leads where organization_id=${organizationId} and lower(trim(email))=${email} and id<>${String(l.id)} limit 1`;if(duplicate[0])throw new Error("Já existe outro lead com este e-mail na conta.");await assertNotBlocked(organizationId,email,String(l.phone||""));const score=await calculateScore(organizationId,{...l,email});const rows=await sql`update leads set first_name=${String(l.first_name)},last_name=${String(l.last_name||"")},email=${email},phone=${String(l.phone||"")},company=${String(l.company)},job_title=${String(l.job_title||"")},score=${score},source=${String(l.source||"")},custom_data=${JSON.stringify(l.custom_data||{})},observations=${String(l.observations||"")},updated_at=now() where id=${String(l.id)} and organization_id=${organizationId} returning id`;
      if(!rows[0])return NextResponse.json({error:"Lead não encontrado"},{status:404});return NextResponse.json({ok:true});
    }
    if(body.action==="updateLeadObservations"){
      const rows=await sql`update leads set observations=${String(body.observations||"")},updated_at=now() where id=${String(body.id)} and organization_id=${organizationId} returning id`;
      if(!rows[0])return NextResponse.json({error:"Lead não encontrado"},{status:404});
      await sql`insert into lead_events (lead_id,actor_id,event_type,title,body) values (${String(body.id)},${user.id},'observations_updated','Observações atualizadas',${String(body.observations||"")})`;
      return NextResponse.json({ok:true});
    }
    if(body.action==="changeLeadOwner"){
      const target=String(body.userId||"");const assignees=await sql`select user_id,first_name,last_name from profiles where user_id=${target} and organization_id=${organizationId} and status='active' limit 1`;if(!assignees[0])throw new Error("Selecione um responsável ativo do time.");
      const rows=await sql`update leads set created_by=${target},updated_at=now() where id=${String(body.leadId)} and organization_id=${organizationId} returning id`;if(!rows[0])return NextResponse.json({error:"Lead não encontrado"},{status:404});
      await sql`update activities set assigned_to=${target},updated_at=now() where lead_id=${String(body.leadId)} and status='pending'`;
      const name=`${String(assignees[0].first_name||"")} ${String(assignees[0].last_name||"")}`.trim();await sql`insert into lead_events (lead_id,actor_id,event_type,title,body) values (${String(body.leadId)},${user.id},'owner_changed','Responsável alterado',${`Novo responsável: ${name}`})`;return NextResponse.json({ok:true});
    }
    if(body.action==="deleteLead"){
      const rows=await sql`delete from leads where id=${String(body.id)} and organization_id=${organizationId} returning id`;
      if(!rows[0])return NextResponse.json({error:"Lead não encontrado"},{status:404});return NextResponse.json({ok:true});
    }
    if(body.action==="bulkDeleteLeads"){
      const ids=(body.leadIds||[]).map(String);if(!ids.length)throw new Error("Selecione ao menos um lead.");
      const rows=await sql`delete from leads where organization_id=${organizationId} and id=any(${ids}::uuid[]) returning id`;
      return NextResponse.json({ok:true,deleted:rows.length});
    }
    if(body.action==="updateMyProfile"){
      await sql`update profiles set first_name=${String(body.profile.first_name||"")},last_name=${String(body.profile.last_name||"")},phone=${String(body.profile.phone||"")},updated_at=now() where user_id=${user.id}`;return NextResponse.json({ok:true});
    }
    if(body.action==="updateOrganization"){
      await sql`update organizations set name=${String(body.name||"")},updated_at=now() where id=${organizationId}`;return NextResponse.json({ok:true});
    }
    if(body.action==="setLeadStatus"){
      const status=String(body.status);const rows=await sql`update leads set status=${status},loss_reason_id=${body.lossReasonId?String(body.lossReasonId):null},won_at=${status==="won"?new Date().toISOString():null},lost_at=${status==="lost"?new Date().toISOString():null},archived_at=${status==="archived"?new Date().toISOString():null},updated_at=now() where id=${String(body.id)} and organization_id=${organizationId} returning id`;
      if(!rows[0])return NextResponse.json({error:"Lead não encontrado"},{status:404});if(status==="won"||status==="lost"){const current=body.activityId?await sql`select id,title from activities where id=${String(body.activityId)} and lead_id=${String(body.id)} and status='pending' limit 1`:await sql`select id,title from activities where lead_id=${String(body.id)} and status='pending' order by due_at limit 1`;if(current[0]){await sql`update activities set status='completed',completed_at=now(),updated_at=now() where id=${current[0].id}`;await sql`insert into lead_events (lead_id,actor_id,event_type,title,body) values (${String(body.id)},${user.id},'completed',${status==="won"?'Atividade concluída com ganho':'Atividade concluída com perda'},${String(current[0].title)})`;}await sql`update activities set status='cancelled',updated_at=now() where lead_id=${String(body.id)} and status='pending'`;}if(["qualified","won","lost","archived"].includes(status))await sql`update lead_cadences set status='stopped' where lead_id=${String(body.id)} and status in ('active','paused')`;if(status==="won")await sql`insert into feedback_requests (organization_id,lead_id,created_by) values (${organizationId},${String(body.id)},${user.id}) on conflict (lead_id) do nothing`;await sql`insert into lead_events (lead_id,actor_id,event_type,title,body) values (${String(body.id)},${user.id},'status_changed','Status alterado',${status})`;return NextResponse.json({ok:true});
    }
    if(body.action==="changeCadence"){
      await sql`update activities set status='cancelled',updated_at=now() where lead_id=${String(body.leadId)} and cadence_step_id is not null and status='pending'`;
      await attachCadence(organizationId,user.id,String(body.leadId),String(body.cadenceId));return NextResponse.json({ok:true});
    }
    if(body.action==="bulkChangeCadence"){
      let changed=0;for(const leadId of body.leadIds||[]){const found=await sql`select id from leads where id=${String(leadId)} and organization_id=${organizationId}`;if(found[0]){await sql`update activities set status='cancelled',updated_at=now() where lead_id=${String(leadId)} and cadence_step_id is not null and status='pending'`;await attachCadence(organizationId,user.id,String(leadId),String(body.cadenceId));changed++;}}return NextResponse.json({changed});
    }
    if(body.action==="pauseCadence"){
      const status=body.paused?"paused":"active";await sql`update lead_cadences lc set status=${status} where lc.lead_id=${String(body.leadId)} and exists(select 1 from leads l where l.id=lc.lead_id and l.organization_id=${organizationId}) and lc.status in ('active','paused')`;await sql`update leads set status=${body.paused?"paused":"prospecting"},updated_at=now() where id=${String(body.leadId)} and organization_id=${organizationId}`;return NextResponse.json({ok:true});
    }
    if(body.action==="createActivityTemplate"||body.action==="updateActivityTemplate"){
      const t=body.template;if(!String(t.name||"").trim())throw new Error("Informe o nome da atividade.");
      if(String(t.type)==="meeting")throw new Error("Reunião não é um tipo de atividade disponível.");
      if(body.action==="createActivityTemplate"){const rows=await sql`insert into activity_templates (organization_id,name,type,instructions,email_subject,email_body,active) values (${organizationId},${String(t.name)},${String(t.type)},${String(t.instructions||"")},${t.email_subject?String(t.email_subject):null},${t.email_body?String(t.email_body):null},true) returning id`;return NextResponse.json({ok:true,id:rows[0].id});}
      await sql`update activity_templates set name=${String(t.name)},type=${String(t.type)},instructions=${String(t.instructions||"")},email_subject=${t.email_subject?String(t.email_subject):null},email_body=${t.email_body?String(t.email_body):null},updated_at=now() where id=${String(t.id)} and organization_id=${organizationId}`;return NextResponse.json({ok:true});
    }
    if(body.action==="toggleActivityTemplate"){await sql`update activity_templates set active=${Boolean(body.active)},updated_at=now() where id=${String(body.id)} and organization_id=${organizationId}`;return NextResponse.json({ok:true});}
    if(body.action==="createCadence"||body.action==="updateCadence"){
      const c=body.cadence;let cadenceId=String(c.id||"");
      const focus=['inbound_active','inbound_passive','outbound','other'].includes(String(c.focus))?String(c.focus):'outbound';const priority=['low','normal','high'].includes(String(c.priority))?String(c.priority):'normal';const lossDays=Math.max(0,Number(c.automatic_loss_days||0));const lossReasonId=c.automatic_loss_reason_id?String(c.automatic_loss_reason_id):null;
      if(body.action==="createCadence"){const rows=await sql`insert into cadences (organization_id,name,description,active,focus,priority,automatic_loss_days,automatic_loss_reason_id) values (${organizationId},${String(c.name)},${String(c.description||"")},${c.active!==false},${focus},${priority},${lossDays},${lossReasonId}) returning id`;cadenceId=String(rows[0].id);}else{await sql`update cadences set name=${String(c.name)},description=${String(c.description||"")},active=${c.active!==false},focus=${focus},priority=${priority},automatic_loss_days=${lossDays},automatic_loss_reason_id=${lossReasonId},updated_at=now() where id=${cadenceId} and organization_id=${organizationId}`;await sql`delete from cadence_steps where cadence_id=${cadenceId}`;}
      for(const [i,s] of (c.steps||[]).entries()){
        const templates=await sql`select id,name,type,instructions from activity_templates where id=${String(s.template_id||"")} and organization_id=${organizationId} and active=true and type<>'meeting' limit 1`;
        if(!templates[0])throw new Error("Selecione uma atividade válida em todas as etapas.");const t=templates[0];
        await insertStep(cadenceId,{template_id:String(t.id),step_order:i+1,day_offset:Number(s.day_offset),type:String(t.type),title:String(t.name),instructions:String(t.instructions||""),suggested_time:String(s.suggested_time||"09:00")});
      }return NextResponse.json({ok:true,id:cadenceId});
    }
    if(body.action==="toggleCadence"){await sql`update cadences set active=${Boolean(body.active)},updated_at=now() where id=${String(body.id)} and organization_id=${organizationId}`;return NextResponse.json({ok:true});}
    if(body.action==="createLossReason"){await sql`insert into loss_reasons (organization_id,name) values (${organizationId},${String(body.name)}) on conflict(organization_id,name) do update set active=true`;return NextResponse.json({ok:true});}
    if(body.action==="toggleLossReason"){await sql`update loss_reasons set active=${Boolean(body.active)} where id=${String(body.id)} and organization_id=${organizationId}`;return NextResponse.json({ok:true});}
    if(body.action==="inviteUser"){
      await requireAdmin(profile);const email=String(body.user?.email||"").trim().toLowerCase();if(!email)throw new Error("Informe o e-mail do usuário.");
      const capacity=await sql`select o.plan_status,o.licensed_seats,(select count(*)::int from profiles p where p.organization_id=o.id and p.status='active') active_users,(select count(*)::int from user_invites i where i.organization_id=o.id and i.status='pending') pending_invites from organizations o where o.id=${organizationId} limit 1`;if(capacity[0]?.plan_status==='active'&&Number(capacity[0].active_users)+Number(capacity[0].pending_invites)>=Number(capacity[0].licensed_seats))throw new Error("O plano atual não possui acessos disponíveis.");
      const existing=await sql`select user_id from profiles where organization_id=${organizationId} and lower(email)=lower(${email}) and status<>'deleted' limit 1`;if(existing[0])throw new Error("Este usuário já pertence ao time.");
      const role=['admin','manager','member'].includes(String(body.user?.role))?String(body.user.role):'member';const rows=await sql`insert into user_invites (organization_id,email,first_name,last_name,role,invited_by,status) values (${organizationId},${email},${String(body.user?.first_name||"")},${String(body.user?.last_name||"")},${role},${user.id},'pending') on conflict(organization_id,email) do update set first_name=excluded.first_name,last_name=excluded.last_name,role=excluded.role,status='pending',token=gen_random_uuid(),invited_by=excluded.invited_by,created_at=now(),accepted_at=null returning id,token`;
      const info=await sql`select o.name as organization_name,concat_ws(' ',p.first_name,p.last_name) as inviter_name from organizations o join profiles p on p.user_id=${user.id} where o.id=${organizationId} limit 1`;const delivery=await sendInviteEmail({to:email,firstName:String(body.user?.first_name||''),inviterName:String(info[0]?.inviter_name||'A equipe'),organizationName:String(info[0]?.organization_name||'ProspecFlow'),role,inviteUrl:inviteUrl(request,rows[0].token)});
      return NextResponse.json({ok:true,id:rows[0].id,token:rows[0].token,emailSent:delivery.sent,emailError:delivery.error||null});
    }
    if(body.action==="resendInvite"){
      await requireAdmin(profile);const rows=await sql`select i.id,i.email,i.first_name,i.role,i.token,o.name as organization_name,concat_ws(' ',p.first_name,p.last_name) as inviter_name from user_invites i join organizations o on o.id=i.organization_id join profiles p on p.user_id=${user.id} where i.id=${String(body.id)} and i.organization_id=${organizationId} and i.status='pending' limit 1`;if(!rows[0])throw new Error('Convite pendente não encontrado.');const delivery=await sendInviteEmail({to:String(rows[0].email),firstName:String(rows[0].first_name||''),inviterName:String(rows[0].inviter_name||'A equipe'),organizationName:String(rows[0].organization_name),role:String(rows[0].role),inviteUrl:inviteUrl(request,rows[0].token)});if(!delivery.sent)throw new Error(delivery.error||'Não foi possível enviar o convite.');return NextResponse.json({ok:true,emailSent:true});
    }
    if(body.action==="cancelInvite"){await requireAdmin(profile);await sql`update user_invites set status='cancelled' where id=${String(body.id)} and organization_id=${organizationId}`;return NextResponse.json({ok:true});}
    if(body.action==="updateUser"){
      await requireAdmin(profile);const target=String(body.userId);const rows=await sql`select role from profiles where user_id=${target} and organization_id=${organizationId} and status<>'deleted' limit 1`;if(!rows[0])throw new Error("Usuário não encontrado.");if(rows[0].role==='owner')throw new Error("O proprietário principal não pode ser alterado.");
      await sql`update profiles set role=${String(body.role||"member")},status=${body.status==='suspended'?'suspended':'active'},updated_at=now() where user_id=${target} and organization_id=${organizationId}`;return NextResponse.json({ok:true});
    }
    if(body.action==="deleteUser"){
      await requireAdmin(profile);const target=String(body.userId);if(target===user.id)throw new Error("Você não pode excluir o próprio acesso.");const rows=await sql`select role from profiles where user_id=${target} and organization_id=${organizationId} limit 1`;if(rows[0]?.role==='owner')throw new Error("O proprietário principal não pode ser excluído.");
      await sql`update profiles set status='deleted',deleted_at=now(),updated_at=now() where user_id=${target} and organization_id=${organizationId}`;await sql`update activities set assigned_to=null where assigned_to=${target}`;return NextResponse.json({ok:true});
    }
    if(body.action==="saveSettings"){
      await requireAdmin(profile);const s=body.settings;await sql`insert into organization_settings (organization_id,weekly_goal,daily_activity_goal,conversion_goal_pct,meeting_goal,monthly_gain_goal,work_days,work_start,work_end,custom_fields,score_rules,score_rules_v2,feedback_prompt,blocklist,default_role,email_sender_name,email_reply_to,role_permissions) values (${organizationId},${Number(s.weekly_goal||0)},${Number(s.daily_activity_goal||0)},${Number(s.conversion_goal_pct||0)},${Number(s.meeting_goal||0)},${Number(s.monthly_gain_goal||0)},${s.work_days||[1,2,3,4,5]},${String(s.work_start||"08:00")},${String(s.work_end||"18:00")},${JSON.stringify(s.custom_fields||[])},${String(s.score_rules||"")},${JSON.stringify(s.score_rules_v2||[])},${String(s.feedback_prompt||"")},${JSON.stringify(s.blocklist||[])},${String(s.default_role||"member")},${String(s.email_sender_name||"")},${String(s.email_reply_to||"")},${JSON.stringify(s.role_permissions||{})}) on conflict(organization_id) do update set weekly_goal=excluded.weekly_goal,daily_activity_goal=excluded.daily_activity_goal,conversion_goal_pct=excluded.conversion_goal_pct,meeting_goal=excluded.meeting_goal,monthly_gain_goal=excluded.monthly_gain_goal,work_days=excluded.work_days,work_start=excluded.work_start,work_end=excluded.work_end,custom_fields=excluded.custom_fields,score_rules=excluded.score_rules,score_rules_v2=excluded.score_rules_v2,feedback_prompt=excluded.feedback_prompt,blocklist=excluded.blocklist,default_role=excluded.default_role,email_sender_name=excluded.email_sender_name,email_reply_to=excluded.email_reply_to,role_permissions=excluded.role_permissions,updated_at=now()`;
      const currentLeads=await sql`select id,first_name,last_name,email,phone,company,job_title,source,custom_data from leads where organization_id=${organizationId}`;for(const lead of currentLeads){const score=await calculateScore(organizationId,lead);await sql`update leads set score=${score},updated_at=now() where id=${lead.id}`;}return NextResponse.json({ok:true});
    }
    if(body.action==="createWebhookIntegration"||body.action==="updateWebhookIntegration"){
      const integration=body.integration||{},cadenceId=String(integration.cadence_id||""),assignedTo=String(integration.assigned_to||"");
      if(!String(integration.name||"").trim()||!cadenceId||!assignedTo)throw new Error("Informe nome, cadência e responsável.");
      const validCadence=await sql`select id from cadences where id=${cadenceId} and organization_id=${organizationId} and active=true limit 1`;
      const validOwner=await sql`select user_id from profiles where user_id=${assignedTo} and organization_id=${organizationId} and status='active' limit 1`;
      if(!validCadence[0]||!validOwner[0])throw new Error("Cadência ou responsável inválido.");
      if(body.action==="createWebhookIntegration"){
        const secret=webhookSecret(),rows=await sql`insert into webhook_integrations (organization_id,name,cadence_id,assigned_to,secret_hash,active,created_by) values (${organizationId},${String(integration.name).trim()},${cadenceId},${assignedTo},${webhookSecretHash(secret)},true,${user.id}) returning id,webhook_key::text`;
        return NextResponse.json({ok:true,data:rows[0],secret});
      }
      const id=String(integration.id||"");await sql`update webhook_integrations set name=${String(integration.name).trim()},cadence_id=${cadenceId},assigned_to=${assignedTo},active=${integration.active!==false},updated_at=now() where id=${id} and organization_id=${organizationId}`;
      return NextResponse.json({ok:true});
    }
    if(body.action==="toggleWebhookIntegration"){
      await sql`update webhook_integrations set active=${Boolean(body.active)},updated_at=now() where id=${String(body.id)} and organization_id=${organizationId}`;return NextResponse.json({ok:true});
    }
    if(body.action==="regenerateWebhookSecret"){
      const secret=webhookSecret(),rows=await sql`update webhook_integrations set secret_hash=${webhookSecretHash(secret)},updated_at=now() where id=${String(body.id)} and organization_id=${organizationId} returning webhook_key::text`;
      if(!rows[0])throw new Error("Integração não encontrada.");return NextResponse.json({ok:true,data:rows[0],secret});
    }
    if(body.action==="deleteWebhookIntegration"){
      const rows=await sql`delete from webhook_integrations where id=${String(body.id)} and organization_id=${organizationId} returning id`;
      if(!rows[0])throw new Error("Integração não encontrada.");return NextResponse.json({ok:true});
    }
    return NextResponse.json({error:"Ação inválida"},{status:400});
  } catch(error) {
    const message=error instanceof Error?error.message:"Não foi possível concluir a operação.";
    return NextResponse.json({error:message.includes("unique")?"Já existe um registro com estes dados.":message},{status:400});
  }
}
