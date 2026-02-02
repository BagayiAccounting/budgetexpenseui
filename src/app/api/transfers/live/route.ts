import { NextRequest } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getBaseUrl, getOptionalSurrealHeaders } from "@/lib/surrealdb";

export async function GET(request: NextRequest) {
  // Get user session
  const session = await auth0.getSession();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const audience = process.env.AUTH0_AUDIENCE || process.env.NEXT_PUBLIC_AUTH0_AUDIENCE;
  const scope = process.env.AUTH0_SCOPE;
  const accessTokenOptions = {
    ...(audience ? { audience } : {}),
    ...(scope ? { scope } : {}),
  };

  const { token } = await auth0.getAccessToken(accessTokenOptions);
  if (!token) {
    return new Response("No access token", { status: 401 });
  }

  // Get account IDs from query params
  const searchParams = request.nextUrl.searchParams;
  const accountIds = searchParams.get("accountIds");
  
  if (!accountIds) {
    return new Response("Missing accountIds parameter", { status: 400 });
  }

  const baseUrl = getBaseUrl();
  const surrealHeaders = getOptionalSurrealHeaders();

  // Build the LIVE SELECT query for transfers involving these accounts
  // We'll watch for changes on the transfer table
  const accountIdList = accountIds.split(",").map(id => `"${id}"`).join(",");
  const liveQuery = `LIVE SELECT * FROM transfer WHERE from_account_id IN [${accountIdList}] OR to_account_id IN [${accountIdList}];`;

  // Create a readable stream that polls for updates
  // Note: For true live queries, we'd need WebSocket. This is a polling fallback.
  const encoder = new TextEncoder();
  
  let lastTransferIds: string[] = [];
  let lastTransferData: Record<string, Record<string, unknown>> = {};
  
  const stream = new ReadableStream({
    async start(controller) {
      // Send initial connection message
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "connected" })}\n\n`));
      
      // Poll for changes every 2 seconds
      const pollInterval = setInterval(async () => {
        try {
          // Fetch current transfers
          const query = `
            SELECT 
              id, 
              amount, 
              type, 
              status, 
              label, 
              description,
              from_account_id.id as from_account_id,
              from_account_id.name as from_account_name,
              to_account_id.id as to_account_id,
              to_account_id.name as to_account_name,
              created_at,
              updated_at,
              tb_transfer_id,
              external_acc_id
            FROM transfer 
            WHERE from_account_id IN [${accountIdList}] OR to_account_id IN [${accountIdList}]
            ORDER BY created_at DESC
            LIMIT 50;
          `;
          
          const res = await fetch(`${baseUrl}/sql`, {
            method: "POST",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${token}`,
              "Content-Type": "text/plain",
              ...surrealHeaders,
            },
            body: query,
          });

          if (!res.ok) {
            return;
          }

          const data = await res.json();
          if (!Array.isArray(data) || data[0]?.status === "ERR") {
            return;
          }

          const transfers = data[0]?.result || [];
          
          // Check for changes
          const currentIds = transfers.map((t: Record<string, unknown>) => String(t.id));
          const hasNewTransfers = currentIds.some((id: string) => !lastTransferIds.includes(id));
          
          // Check for status changes in existing transfers
          let hasUpdates = false;
          for (const transfer of transfers) {
            const id = String(transfer.id);
            const prev = lastTransferData[id];
            if (prev && (prev.status !== transfer.status || prev.updated_at !== transfer.updated_at)) {
              hasUpdates = true;
              break;
            }
          }
          
          if (hasNewTransfers || hasUpdates) {
            // Send update event
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
              type: "update", 
              transfers: transfers.map((t: Record<string, unknown>) => ({
                id: String(t.id),
                fromAccountId: String(t.from_account_id || ""),
                fromAccountName: String(t.from_account_name || ""),
                toAccountId: String(t.to_account_id || ""),
                toAccountName: String(t.to_account_name || ""),
                amount: Number(t.amount) || 0,
                type: String(t.type || "payment"),
                status: String(t.status || "draft"),
                label: t.label ? String(t.label) : undefined,
                description: t.description ? String(t.description) : undefined,
                createdAt: String(t.created_at || ""),
                updatedAt: t.updated_at ? String(t.updated_at) : undefined,
                tbTransferId: t.tb_transfer_id ? String(t.tb_transfer_id) : undefined,
                externalTransactionId: t.external_acc_id ? String(t.external_acc_id) : undefined,
              }))
            })}\n\n`));
            
            // Update tracking state
            lastTransferIds = currentIds;
            lastTransferData = {};
            for (const transfer of transfers) {
              lastTransferData[String(transfer.id)] = transfer;
            }
          }
        } catch {
          // Silently handle errors, connection might be closed
        }
      }, 2000);

      // Cleanup on close
      request.signal.addEventListener("abort", () => {
        clearInterval(pollInterval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
