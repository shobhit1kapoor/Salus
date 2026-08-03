import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function EntryPage() {
  const cookieStore = await cookies();
  redirect(cookieStore.has("salus_session") ? "/dashboard" : "/login");
}
