import AuthForm from "@/components/AuthForm";
import { isNeonConfigured } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

export default function AuthPage() {
  return <AuthForm backendConfigured={isNeonConfigured} />;
}
