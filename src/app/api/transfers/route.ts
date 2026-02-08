import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { executeSurrealQL, toSurrealThingLiteral, getResultArray } from "@/lib/surrealdb";

export async function POST(req: NextRequest) {
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
      return NextResponse.json({ error: "No access token", reason: "missing_token" }, { status: 401 });
    }

    const body = await req.json();
    const { fromAccountId, toAccountId, amount, type, status, description, label, paymentChannel, createdAt, metadata, externalTransactionId } = body;

    // Validate required fields - toAccountId is optional if paymentChannel is provided
    if (!fromAccountId || !amount || !type) {
      return NextResponse.json({ error: "Missing required fields", reason: "missing_fields" }, { status: 400 });
    }

    // Either toAccountId or paymentChannel must be provided
    if (!toAccountId && !paymentChannel) {
      return NextResponse.json({ error: "Either toAccountId or paymentChannel is required", reason: "missing_destination" }, { status: 400 });
    }

    if (amount <= 0) {
      return NextResponse.json({ error: "Amount must be positive", reason: "invalid_amount" }, { status: 400 });
    }

    const fromLiteral = toSurrealThingLiteral(fromAccountId);
    if (!fromLiteral) {
      return NextResponse.json({ error: "Invalid fromAccountId", reason: "invalid_account_id" }, { status: 400 });
    }

    let toLiteral = null;
    if (toAccountId) {
      toLiteral = toSurrealThingLiteral(toAccountId);
      if (!toLiteral) {
        return NextResponse.json({ error: "Invalid toAccountId", reason: "invalid_account_id" }, { status: 400 });
      }
    }

    // Get user ID for created_by field
    const userQuery = "SELECT VALUE id FROM user WHERE auth_sub = $token.sub LIMIT 1;";
    
    const userResult = await executeSurrealQL({
      token,
      query: userQuery,
      logName: "transferAPI.POST /sql (get user)",
    });

    if (!userResult.success) {
      return NextResponse.json(
        { error: "Failed to get user", reason: userResult.error, details: userResult.details },
        { status: 500 },
      );
    }

    const userId = getResultArray(userResult.data[0])[0];

    if (!userId) {
      return NextResponse.json({ error: "User not found", reason: "user_not_found" }, { status: 404 });
    }

    const userLiteral = toSurrealThingLiteral(String(userId));
    if (!userLiteral) {
      return NextResponse.json({ error: "Invalid user ID", reason: "invalid_user_id" }, { status: 500 });
    }

    // Build the transfer creation query
    const transferStatus = status || "draft";
    
    // Build the content object
    let contentFields = `from_account_id: ${fromLiteral}`;
    
    // Add to_account_id only if provided (not for payment channel transactions)
    if (toLiteral) {
      contentFields += `,\n  to_account_id: ${toLiteral}`;
    }
    
    contentFields += `,\n  amount: ${amount}`;
    contentFields += `,\n  type: ${JSON.stringify(type)}`;
    contentFields += `,\n  status: ${JSON.stringify(transferStatus)}`;
    contentFields += `,\n  created_by: ${userLiteral}`;
    
    if (description) {
      contentFields += `,\n  description: ${JSON.stringify(description)}`;
    }
    
    if (label) {
      contentFields += `,\n  label: ${JSON.stringify(label)}`;
    }
    
    // Add created_at if provided (for backdating manual transactions)
    if (createdAt) {
      // Validate the date format
      const date = new Date(createdAt);
      if (!isNaN(date.getTime())) {
        contentFields += `,\n  created_at: <datetime>${JSON.stringify(createdAt)}`;
      }
    }
    
    // Add payment_channel if provided
    if (paymentChannel) {
      // For bagayi_inter_switch channel, to_account should be a record reference
      if (paymentChannel.channelId === "bagayi_inter_switch") {
        const toAccountLiteral = toSurrealThingLiteral(paymentChannel.toAccount);
        if (toAccountLiteral) {
          // Build payment integration reference if provided
          const paymentIntegrationLiteral = paymentChannel.paymentIntegration 
            ? toSurrealThingLiteral(paymentChannel.paymentIntegration)
            : null;
          
          if (paymentIntegrationLiteral) {
            contentFields += `,\n  payment_channel: {
    channel_id: ${JSON.stringify(paymentChannel.channelId)},
    to_account: ${toAccountLiteral},
    payment_integration: ${paymentIntegrationLiteral}
  }`;
          } else {
            contentFields += `,\n  payment_channel: {
    channel_id: ${JSON.stringify(paymentChannel.channelId)},
    to_account: ${toAccountLiteral}
  }`;
          }
        } else {
          return NextResponse.json({ error: "Invalid to_account for bagayi_inter_switch channel", reason: "invalid_payment_channel_account" }, { status: 400 });
        }
      } else if (paymentChannel.channelId === "MPESA") {
        // For MPESA channel, use new structure: channel_id: "MPESA", action: "BusinessPayment"|"BusinessBuyGoods"|"BusinessPayBill", to_account: string
        // BusinessPayBill also includes account_reference
        if (paymentChannel.action === "BusinessPayBill" && paymentChannel.accountReference) {
          contentFields += `,\n  payment_channel: {
    channel_id: "MPESA",
    action: ${JSON.stringify(paymentChannel.action)},
    to_account: ${JSON.stringify(paymentChannel.toAccount)},
    account_reference: ${JSON.stringify(paymentChannel.accountReference)}
  }`;
        } else {
          contentFields += `,\n  payment_channel: {
    channel_id: "MPESA",
    action: ${JSON.stringify(paymentChannel.action)},
    to_account: ${JSON.stringify(paymentChannel.toAccount)}
  }`;
        }
      } else {
        // For other channels, to_account is a string (legacy support)
        contentFields += `,\n  payment_channel: {
    channel_id: ${JSON.stringify(paymentChannel.channelId)},
    to_account: ${JSON.stringify(paymentChannel.toAccount)}
  }`;
      }
    }
    
    // Add metadata if provided (for external account transfers)
    if (metadata && typeof metadata === "object" && Object.keys(metadata).length > 0) {
      contentFields += `,\n  metadata: ${JSON.stringify(metadata)}`;
    }
    
    // Add external_transaction_id if provided (required for external account transfers)
    if (externalTransactionId) {
      contentFields += `,\n  external_transaction_id: ${JSON.stringify(externalTransactionId)}`;
    }
    
    const query = `CREATE transfer CONTENT {
  ${contentFields}
};`;

    const createResult = await executeSurrealQL({
      token,
      query,
      logName: "transferAPI.POST /sql (create transfer)",
    });

    if (!createResult.success) {
      return NextResponse.json(
        { error: "Failed to create transfer", reason: createResult.error, details: createResult.details },
        { status: 400 },
      );
    }

    const result = getResultArray(createResult.data[0])[0];

    if (!result) {
      return NextResponse.json({ error: "Permission denied: You don't have permission to create this transfer", reason: "permission_denied_create_transfer" }, { status: 403 });
    }

    return NextResponse.json({ success: true, transfer: result });
  } catch (error) {
    console.error("Transfer creation error:", error);
    return NextResponse.json(
      { error: "Internal server error", reason: "server_error" },
      { status: 500 },
    );
  }
}
