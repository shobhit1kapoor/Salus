import { cookies } from "next/headers";
import { MarketingLanding } from "../components/marketing-landing";

export default async function EntryPage() {
  const cookieStore = await cookies();
  return <MarketingLanding signedIn={cookieStore.has("salus_session")} />;
}
