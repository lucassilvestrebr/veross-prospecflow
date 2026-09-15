import ProspecFlowApp from "@/components/ProspecFlowApp";
import { isNeonConfigured } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

export default function Home() {
  return <ProspecFlowApp backendConfigured={isNeonConfigured} />;
}
