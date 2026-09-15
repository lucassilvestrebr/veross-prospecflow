import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth-server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

async function stripe(path:string, params:URLSearchParams){
  const secret=process.env.STRIPE_SECRET_KEY;if(!secret)throw new Error("A integração Stripe ainda não foi configurada.");
  const response=await fetch(`https://api.stripe.com/v1/${path}`,{method:"POST",headers:{authorization:`Bearer ${secret}`,"content-type":"application/x-www-form-urlencoded"},body:params});
  const result=await response.json();if(!response.ok)throw new Error(result.error?.message||"Não foi possível iniciar o pagamento.");return result;
}

export async function POST(request:NextRequest){
  try{
    const {data}=await auth.getSession();const user=data?.user;if(!user)return NextResponse.json({error:"Não autorizado"},{status:401});
    const {seats}=await request.json();const count=Number(seats);if(![1,2,3].includes(count))return NextResponse.json({error:"Plano inválido"},{status:400});
    const priceIds:Record<number,string|undefined>={1:process.env.STRIPE_PRICE_1_USER,2:process.env.STRIPE_PRICE_2_USERS,3:process.env.STRIPE_PRICE_3_USERS};const price=priceIds[count];if(!price)throw new Error("Cadastre o Price ID deste plano na Vercel.");
    const sql=getDb();const rows=await sql`select o.id,o.stripe_customer_id,p.email,p.role from profiles p join organizations o on o.id=p.organization_id where p.user_id=${user.id} and p.status='active' limit 1`;const account=rows[0];if(!account||!['owner','admin'].includes(String(account.role)))return NextResponse.json({error:"Apenas administradores podem contratar planos."},{status:403});
    let customer=account.stripe_customer_id as string|undefined;if(!customer){const created=await stripe("customers",new URLSearchParams({email:String(account.email),"metadata[organization_id]":String(account.id)}));customer=created.id;await sql`update organizations set stripe_customer_id=${customer} where id=${account.id}`;}
    const origin=new URL(request.url).origin;const params=new URLSearchParams({mode:"subscription",customer:String(customer),"line_items[0][price]":price,"line_items[0][quantity]":String(count),success_url:`${origin}/?pagamento=sucesso`,cancel_url:`${origin}/?pagamento=cancelado`,"subscription_data[metadata][organization_id]":String(account.id),"subscription_data[metadata][licensed_seats]":String(count),allow_promotion_codes:"true"});
    const session=await stripe("checkout/sessions",params);return NextResponse.json({url:session.url});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Falha no pagamento"},{status:400});}
}
