import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { executeSurrealQL, getResultArray } from "@/lib/surrealdb";

type FrequentRecipient = {
  toAccount: string;
  accountReference?: string;
  name: string;
  count: number;
  fromAccountId: string;
  lastUsed: string;
};

// Helper to extract name from M-Pesa callback data
function extractNameFromPaymentChannel(
  paymentChannel: Record<string, unknown>,
  action: string
): string {
  try {
    if (action === "BusinessPayment") {
      // For send money, use ReceiverPartyPublicName from mpesa_callback
      const mpesaCallback = paymentChannel.mpesa_callback as Record<string, unknown> | undefined;
      if (mpesaCallback?.ResultParameters) {
        const resultParams = mpesaCallback.ResultParameters as { ResultParameter?: Array<{ Key: string; Value?: unknown }> };
        if (resultParams.ResultParameter) {
          const receiverParam = resultParams.ResultParameter.find((p) => p.Key === "ReceiverPartyPublicName");
          if (receiverParam?.Value) {
            // Value is like "254702729654 - FRANCIS MURAYA", extract just the name
            const parts = String(receiverParam.Value).split(" - ");
            if (parts.length > 1) {
              return parts.slice(1).join(" - ").trim();
            }
            return String(receiverParam.Value);
          }
        }
      }
    } else if (action === "BusinessBuyGoods") {
      // For buy goods, use CreditPartyName from mpesa_transaction_status_callback
      const statusCallback = paymentChannel.mpesa_transaction_status_callback as Record<string, unknown> | undefined;
      if (statusCallback?.ResultParameters) {
        const resultParams = statusCallback.ResultParameters as { ResultParameter?: Array<{ Key: string; Value?: unknown }> };
        if (resultParams.ResultParameter) {
          const creditParam = resultParams.ResultParameter.find((p) => p.Key === "CreditPartyName");
          if (creditParam?.Value) {
            // Value is like "5787140 - DORCUS AUMA ODHIAMBO", extract just the name
            const parts = String(creditParam.Value).split(" - ");
            if (parts.length > 1) {
              return parts.slice(1).join(" - ").trim();
            }
            return String(creditParam.Value);
          }
        }
      }
    } else if (action === "BusinessPayBill") {
      // For paybill, try ReceiverPartyPublicName from mpesa_callback first
      const mpesaCallback = paymentChannel.mpesa_callback as Record<string, unknown> | undefined;
      if (mpesaCallback?.ResultParameters) {
        const resultParams = mpesaCallback.ResultParameters as { ResultParameter?: Array<{ Key: string; Value?: unknown }> };
        if (resultParams.ResultParameter) {
          const receiverParam = resultParams.ResultParameter.find((p) => p.Key === "ReceiverPartyPublicName");
          if (receiverParam?.Value) {
            // Value is like "247247 - Equity Paybill Account"
            const parts = String(receiverParam.Value).split(" - ");
            if (parts.length > 1) {
              return parts.slice(1).join(" - ").trim();
            }
            return String(receiverParam.Value);
          }
        }
      }
      // Fallback to CreditPartyName from mpesa_transaction_status_callback
      const statusCallback = paymentChannel.mpesa_transaction_status_callback as Record<string, unknown> | undefined;
      if (statusCallback?.ResultParameters) {
        const resultParams = statusCallback.ResultParameters as { ResultParameter?: Array<{ Key: string; Value?: unknown }> };
        if (resultParams.ResultParameter) {
          const creditParam = resultParams.ResultParameter.find((p) => p.Key === "CreditPartyName");
          if (creditParam?.Value) {
            const parts = String(creditParam.Value).split(" - ");
            if (parts.length > 1) {
              return parts.slice(1).join(" - ").trim();
            }
            return String(creditParam.Value);
          }
        }
      }
    }
  } catch (e) {
    console.error("Error extracting name from payment channel:", e);
  }
  return "";
}

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

    // Step 1: Get unique to_account values with counts
    const countQuery = `
      SELECT 
        payment_channel.to_account AS to_account,
        payment_channel.account_reference AS account_reference,
        count() AS usage_count
      FROM transfer
      WHERE 
        payment_channel.channel_id = "MPESA" 
        AND payment_channel.action = ${JSON.stringify(action)}
      GROUP BY payment_channel.to_account, payment_channel.account_reference
      ORDER BY usage_count DESC
      LIMIT 20;
    `;

    console.log("Frequent recipients count query:", countQuery);
    if (categoryId) {
      console.log("Category filter (currently disabled):", categoryId);
    }

    const countResult = await executeSurrealQL({
      token,
      query: countQuery,
      logName: "frequentRecipients.GET.count",
    });

    if (!countResult.success) {
      return NextResponse.json(
        { error: "Failed to fetch frequent recipients", reason: countResult.error },
        { status: 500 },
      );
    }

    const countResults = getResultArray(countResult.data[0]) as Array<{
      to_account: string;
      account_reference?: string;
      usage_count: number;
    }>;

    // Step 2: For each unique to_account, get the latest transfer to extract name from payment_channel
    const recipients: FrequentRecipient[] = [];
    const processedKeys = new Set<string>();

    for (const countItem of countResults) {
      if (!countItem.to_account) continue;

      // Build unique key
      const key =
        action === "BusinessPayBill"
          ? `${countItem.to_account}|${countItem.account_reference || ""}`
          : countItem.to_account;

      // Skip if already processed (aggregate counts)
      if (processedKeys.has(key)) {
        const existingRecipient = recipients.find((r) =>
          action === "BusinessPayBill"
            ? r.toAccount === countItem.to_account && r.accountReference === countItem.account_reference
            : r.toAccount === countItem.to_account
        );
        if (existingRecipient) {
          existingRecipient.count += countItem.usage_count;
        }
        continue;
      }
      processedKeys.add(key);

      // Query for the latest transfer to get the name from payment_channel callbacks
      let latestQuery: string;
      if (action === "BusinessPayBill" && countItem.account_reference) {
        latestQuery = `
          SELECT 
            payment_channel,
            label,
            description,
            from_account_id,
            created_at
          FROM transfer
          WHERE 
            payment_channel.channel_id = "MPESA" 
            AND payment_channel.action = ${JSON.stringify(action)}
            AND payment_channel.to_account = ${JSON.stringify(countItem.to_account)}
            AND payment_channel.account_reference = ${JSON.stringify(countItem.account_reference)}
          ORDER BY created_at DESC
          LIMIT 1;
        `;
      } else {
        latestQuery = `
          SELECT 
            payment_channel,
            label,
            description,
            from_account_id,
            created_at
          FROM transfer
          WHERE 
            payment_channel.channel_id = "MPESA" 
            AND payment_channel.action = ${JSON.stringify(action)}
            AND payment_channel.to_account = ${JSON.stringify(countItem.to_account)}
          ORDER BY created_at DESC
          LIMIT 1;
        `;
      }

      const latestResult = await executeSurrealQL({
        token,
        query: latestQuery,
        logName: "frequentRecipients.GET.latest",
      });

      let name = "";
      let fromAccountId = "";
      let lastUsed = "";

      if (latestResult.success) {
        const latestData = getResultArray(latestResult.data[0])[0] as
          | {
              payment_channel?: Record<string, unknown>;
              label?: string;
              description?: string;
              from_account_id?: string;
              created_at?: string;
            }
          | undefined;

        if (latestData) {
          fromAccountId = String(latestData.from_account_id || "");
          lastUsed = String(latestData.created_at || "");

          // Try to extract name from M-Pesa callback
          if (latestData.payment_channel) {
            name = extractNameFromPaymentChannel(latestData.payment_channel, action);
          }

          // Fallback to label or description if no name from callback
          if (!name) {
            name = latestData.label || latestData.description || "";
          }
        }
      }

      recipients.push({
        toAccount: countItem.to_account,
        accountReference: countItem.account_reference,
        name,
        count: countItem.usage_count,
        fromAccountId,
        lastUsed,
      });
    }

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
    const finalRecipients = recipients.slice(0, 10);

    return NextResponse.json({ recipients: finalRecipients });
  } catch (error) {
    console.error("Frequent recipients error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}