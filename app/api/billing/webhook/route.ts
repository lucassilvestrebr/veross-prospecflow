import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

function validSignature(payload:string,header:string,secret:string){const parts=Object.fromEntries(header.split(",").map(x=>x.split("=")));if(!parts.t||!parts.v1)return false;const expected=createHmac("sha256",secret).update(`${parts.t}.${payload}`).digest("hex");const a=Buffer.from(expected);const b=Buffer.from(parts.v1);return a.length===b.length&&timingSafeEqual(a,b);}

export async function POST(request:NextRequest){
  const secret=process.env.STRIPE_WEBHOOK_SECRET;if(!secret)return NextResponse.json({error:"Webhook não configurado"},{status:503});
  const payload=await request.text();const signature=request.headers.get("stripe-signature")||"";if(!validSignature(payload,signature,secret))return NextResponse.json({error:"Assinatura inválida"},{status:400});
  const event=JSON.parse(payload);const object=event.data?.object||{};const organizationId=object.metadata?.organization_id;const sql=getDb();
  if(organizationId&&event.type==="customer.subscription.created")await sql`update organizations set plan_status='active',stripe_subscription_id=${String(object.id)},licensed_seats=${Number(object.metadata?.licensed_seats||1)},updated_at=now() where id=${organizationId}`;
  if(organizationId&&event.type==="customer.subscription.updated"){const status=['active','trialing'].includes(object.status)?'active':object.status==='past_due'?'past_due':'cancelled';await sql`update organizations set plan_status=${status},licensed_seats=${Number(object.metadata?.licensed_seats||1)},updated_at=now() where id=${organizationId}`;}
  if(organizationId&&event.type==="customer.subscription.deleted")await sql`update organizations set plan_status='cancelled',updated_at=now() where id=${organizationId}`;
  return NextResponse.json({received:true});
}
