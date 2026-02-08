import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { executeSurrealQL, getResultArray, toSurrealThingLiteral } from "@/lib/surrealdb";

type FrequentRecipient = {
  toAccount: string;
  accountReference?: string;
  name: string;
  count: number;
  fromAccountId: string;
  lastUsed: string;
};

export async function GET(req: NextRequest) {
  try {
    const session = await auth0.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const audience = process.env.AUTH0_AUDIENCE || process.env.NEXT_PUBLIC_AUTH0_AUDIENCE;
    const scope = process.env.AUTH0_SCOPE;
    const accessTokenOptions = {
      ...(audience ? { audience } : {}),
      ...(scope ? { scope } : {}),
    };

    const { token } = await auth0.getAccessToken(accessTokenOptions);
    if (!token) {
      return NextResponse.json({ error: "No access token" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action"); // BusinessPayment, BusinessBuyGoods, BusinessPayBill
    const categoryId = searchParams.get("categoryId");
    const currentAccountId = searchParams.get("accountId"); // For sorting

    if (!action) {
      return NextResponse.json({ error: "action parameter is required" }, { status: 400 });
    }

    // Build category filter if provided
    let categoryFilter = "";
    if (categoryId) {
      const categoryLiteral = toSurrealThingLiteral(categoryId);
      if (categoryLiteral) {
        categoryFilter = `AND from_account_id.category_id = ${categoryLiteral}`;
      }
    }

    // Query transfers with the specified payment channel action
    // Group by to_account (and account_reference for paybill)
    // Get the name from label or description
    const query = `
      SELECT 
        payment_channel.to_account AS to_account,
        payment_channel.account_reference AS account_reference,
        label,
        description,
        from_account_id,
        count() AS usage_count,
        math::max(created_at) AS last_used
      FROM transfer
      WHERE 
        payment_channel.channel_id = "MPESA" 
        AND payment_channel.action = ${JSON.stringify(action)}
        ${categoryFilter}
      GROUP BY payment_channel.to_account, payment_channel.account_reference, from_account_id, label, description
      ORDER BY usage_count DESC
      LIMIT 50;
    `;
    
    console.log("Frequent recipients query:", query);

    const result = await executeSurrealQL({
      token,
      query,
      logName: "frequentRecipients.GET",
    });

    if (!result.success) {
      return NextResponse.json(
        { error: "Failed to fetch frequent recipients", reason: result.error },
        { status: 500 },
      );
    }

    const rawResults = getResultArray(result.data[0]) as Array<{
      to_account: string;
      account_reference?: string;
      label?: string;
      description?: string;
      from_account_id: string;
      usage_count: number;
      last_used: string;
    }>;

    // Aggregate by to_account (and account_reference for paybill)
    // to combine counts across different labels/descriptions
    const aggregated = new Map<string, FrequentRecipient>();
    
    for (const item of rawResults) {
      if (!item.to_account) continue;
      
      // For paybill, include account_reference in the key
      const key = action === "BusinessPayBill" 
        ? `${item.to_account}|${item.account_reference || ""}`
        : item.to_account;
      
      const existing = aggregated.get(key);
      
      if (existing) {
        existing.count += item.usage_count;
        // Keep the most recent name and last_used
        if (new Date(item.last_used) > new Date(existing.lastUsed)) {
          existing.name = item.label || item.description || "";
          existing.lastUsed = item.last_used;
        }
        // If current account matches, mark it
        if (currentAccountId && item.from_account_id === currentAccountId) {
          existing.fromAccountId = item.from_account_id;
        }
      } else {
        aggregated.set(key, {
          toAccount: item.to_account,
          accountReference: item.account_reference,
          name: item.label || item.description || "",
          count: item.usage_count,
          fromAccountId: item.from_account_id,
          lastUsed: item.last_used,
        });
      }
    }

    // Convert to array and sort
    let recipients = Array.from(aggregated.values());
    
    // Sort: current account first, then by count
    if (currentAccountId) {
      recipients.sort((a, b) => {
        const aIsCurrentAccount = a.fromAccountId === currentAccountId;
        const bIsCurrentAccount = b.fromAccountId === currentAccountId;
        
        if (aIsCurrentAccount && !bIsCurrentAccount) return -1;
        if (!aIsCurrentAccount && bIsCurrentAccount) return 1;
        return b.count - a.count;
      });
    } else {
      recipients.sort((a, b) => b.count - a.count);
    }

    // Limit to top 10
    recipients = recipients.slice(0, 10);

    return NextResponse.json({ recipients });
  } catch (error) {
    console.error("Frequent recipients error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}