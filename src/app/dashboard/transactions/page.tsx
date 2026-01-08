import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import TransactionsClient from "@/components/TransactionsClient";
import { listAllAccounts } from "@/lib/settingsService";

export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const session = await auth0.getSession();
  if (!session?.user) {
    redirect("/");
  }

  const audience = process.env.AUTH0_AUDIENCE || process.env.NEXT_PUBLIC_AUTH0_AUDIENCE;
  const scope = process.env.AUTH0_SCOPE;
  const accessTokenOptions = {
    ...(audience ? { audience } : {}),
    ...(scope ? { scope } : {}),
  };

  let accountsData;
  try {
    const { token } = await auth0.getAccessToken(accessTokenOptions);
    accountsData = await listAllAccounts({ accessToken: token });
  } catch {
    accountsData = { status: "skipped" as const, reason: "token_or_fetch_failed" };
  }

  const accounts = accountsData.status === "ok" ? accountsData.accounts : [];

  return <TransactionsClient accounts={accounts} />;
}
