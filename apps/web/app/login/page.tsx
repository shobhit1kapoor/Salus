import type { Metadata } from "next";
import { AuthEntry } from "../../components/auth-entry";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return <AuthEntry />;
}
