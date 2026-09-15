import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const sql = getDb();
  const rows = await sql`select i.email,i.first_name,i.last_name,i.role,o.name as organization_name
    from user_invites i join organizations o on o.id=i.organization_id
    where i.token::text=${token} and i.status='pending' limit 1`;
  if (!rows[0]) return NextResponse.json({ error: "Este convite não existe ou já foi utilizado." }, { status: 404 });
  return NextResponse.json(rows[0]);
}
