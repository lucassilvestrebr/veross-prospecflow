import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

async function findRequest(token:string){
  const sql=getDb();
  return (await sql`select fr.id,fr.status,fr.responded_at,l.first_name,l.last_name,l.company
    from feedback_requests fr join leads l on l.id=fr.lead_id where fr.token::text=${token} limit 1`)[0];
}

export async function GET(_:NextRequest,{params}:{params:Promise<{token:string}>}){
  try{const {token}=await params;const item=await findRequest(token);if(!item)return NextResponse.json({error:"Link de feedback inválido."},{status:404});return NextResponse.json({leadName:`${item.first_name} ${item.last_name}`.trim(),company:item.company,status:item.status,respondedAt:item.responded_at});}
  catch{return NextResponse.json({error:"Não foi possível carregar este feedback."},{status:500})}
}

export async function POST(request:NextRequest,{params}:{params:Promise<{token:string}>}){
  try{
    const {token}=await params;const item=await findRequest(token);if(!item)return NextResponse.json({error:"Link de feedback inválido."},{status:404});if(item.status==="responded")return NextResponse.json({error:"Este feedback já foi enviado."},{status:409});
    const body=await request.json();if(typeof body.hadMeeting!=="boolean")return NextResponse.json({error:"Informe se a reunião aconteceu."},{status:400});
    const fields=["acceptedAsClient","priorityNow","hasPain","hasBudget","spokeToDecisionMaker"] as const;
    if(body.hadMeeting&&(!body.meetingDate||fields.some(field=>typeof body[field]!=="boolean")))return NextResponse.json({error:"Informe a data da reunião e responda todas as perguntas."},{status:400});
    const sql=getDb();await sql`insert into feedback_responses (request_id,had_meeting,meeting_date,accepted_as_client,priority_now,has_pain,has_budget,spoke_to_decision_maker,observation)
      values (${item.id},${body.hadMeeting},${body.hadMeeting?String(body.meetingDate):null},${body.hadMeeting?body.acceptedAsClient:null},${body.hadMeeting?body.priorityNow:null},${body.hadMeeting?body.hasPain:null},${body.hadMeeting?body.hasBudget:null},${body.hadMeeting?body.spokeToDecisionMaker:null},${String(body.observation||"")})
      on conflict (request_id) do update set had_meeting=excluded.had_meeting,meeting_date=excluded.meeting_date,accepted_as_client=excluded.accepted_as_client,priority_now=excluded.priority_now,has_pain=excluded.has_pain,has_budget=excluded.has_budget,spoke_to_decision_maker=excluded.spoke_to_decision_maker,observation=excluded.observation,updated_at=now()`;
    await sql`update feedback_requests set status='responded',responded_at=now() where id=${item.id}`;return NextResponse.json({ok:true});
  }catch{return NextResponse.json({error:"Não foi possível enviar o feedback."},{status:500})}
}
