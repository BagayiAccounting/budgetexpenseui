import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { executeSurrealQL, getResultArray, thingIdToString, toSurrealThingLiteral } from "@/lib/surrealdb";

const VALID_ROLES = ["viewer", "editor", "admin"];

// GET - List users for a category
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
    const categoryId = searchParams.get("categoryId");

    if (!categoryId) {
      return NextResponse.json({ error: "Missing categoryId parameter" }, { status: 400 });
    }

    const categoryLiteral = toSurrealThingLiteral(categoryId);
    if (!categoryLiteral) {
      return NextResponse.json({ error: "Invalid categoryId" }, { status: 400 });
    }

    // First, fetch category users (without user details due to access policy)
    const categoryUsersQuery = `
      SELECT id, category_id, user_id, role
      FROM category_user 
      WHERE category_id = ${categoryLiteral};
    `;

    const categoryUsersResult = await executeSurrealQL({
      token,
      query: categoryUsersQuery,
      logName: "categoryUsersAPI.GET /sql (list category users)",
    });

    if (!categoryUsersResult.success) {
      return NextResponse.json(
        { error: "Failed to fetch category users", details: categoryUsersResult.error },
        { status: 500 }
      );
    }

    const categoryUsersRaw = getResultArray<{
      id?: unknown;
      category_id?: unknown;
      user_id?: unknown;
      role?: unknown;
    }>(categoryUsersResult.data[0]);

    // Get all user IDs to look up their emails
    const userIds = categoryUsersRaw
      .map((cu) => thingIdToString(cu.user_id))
      .filter((id): id is string => !!id);

    // Fetch user emails from the lookup table (accessible to everyone)
    const userEmailMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const userIdsLiterals = userIds.map((id) => toSurrealThingLiteral(id)).filter(Boolean);
      if (userIdsLiterals.length > 0) {
        const lookupQuery = `SELECT user, email FROM user_email_lookup WHERE user IN [${userIdsLiterals.join(", ")}];`;
        
        const lookupResult = await executeSurrealQL({
          token,
          query: lookupQuery,
          logName: "categoryUsersAPI.GET /sql (lookup user emails)",
        });

        if (lookupResult.success) {
          const lookupData = getResultArray<{ user?: unknown; email?: unknown }>(lookupResult.data[0]);
          for (const entry of lookupData) {
            const userId = thingIdToString(entry.user);
            const email = typeof entry.email === "string" ? entry.email : undefined;
            if (userId && email) {
              userEmailMap[userId] = email;
            }
          }
        }
      }
    }

    const categoryUsers = categoryUsersRaw.map((cu) => {
      const userId = thingIdToString(cu.user_id);
      const userEmail = userId ? userEmailMap[userId] : undefined;
      return {
        id: thingIdToString(cu.id),
        categoryId: thingIdToString(cu.category_id),
        userId,
        userName: userEmail?.split("@")[0], // Use email prefix as display name
        userEmail,
        role: typeof cu.role === "string" ? cu.role : "viewer",
      };
    });

    return NextResponse.json({ categoryUsers });
  } catch (error) {
    console.error("Error fetching category users:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST - Add user to category
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
      return NextResponse.json({ error: "No access token" }, { status: 401 });
    }

    const body = await req.json();
    const { categoryId, userEmail, role } = body;

    if (!categoryId || !userEmail || !role) {
      return NextResponse.json({ error: "Missing required fields: categoryId, userEmail, role" }, { status: 400 });
    }

    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}` }, { status: 400 });
    }

    const categoryLiteral = toSurrealThingLiteral(categoryId);
    if (!categoryLiteral) {
      return NextResponse.json({ error: "Invalid categoryId" }, { status: 400 });
    }

    // Find the user via the user_email_lookup table (accessible to anyone)
    const findUserQuery = `SELECT user FROM user_email_lookup WHERE email = ${JSON.stringify(userEmail)} LIMIT 1;`;
    
    const findUserResult = await executeSurrealQL({
      token,
      query: findUserQuery,
      logName: "categoryUsersAPI.POST /sql (find user via lookup)",
    });

    if (!findUserResult.success) {
      return NextResponse.json({ error: "Failed to find user", details: findUserResult.error }, { status: 500 });
    }

    const usersFound = getResultArray<{ user?: unknown }>(findUserResult.data[0]);
    if (usersFound.length === 0) {
      return NextResponse.json({ error: "User not found with this email" }, { status: 404 });
    }

    const userId = thingIdToString(usersFound[0].user);
    if (!userId) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 500 });
    }

    const userLiteral = toSurrealThingLiteral(userId);
    if (!userLiteral) {
      return NextResponse.json({ error: "Invalid user ID format" }, { status: 500 });
    }

    // Check if user is already assigned to this category
    const checkExistingQuery = `
      SELECT id FROM category_user 
      WHERE category_id = ${categoryLiteral} AND user_id = ${userLiteral}
      LIMIT 1;
    `;

    const checkResult = await executeSurrealQL({
      token,
      query: checkExistingQuery,
      logName: "categoryUsersAPI.POST /sql (check existing)",
    });

    if (checkResult.success) {
      const existing = getResultArray<{ id?: unknown }>(checkResult.data[0]);
      if (existing.length > 0) {
        return NextResponse.json({ error: "User is already assigned to this category" }, { status: 409 });
      }
    }

    // Create category_user entry
    const createQuery = `
      CREATE category_user CONTENT {
        category_id: ${categoryLiteral},
        user_id: ${userLiteral},
        role: ${JSON.stringify(role)}
      };
    `;

    const createResult = await executeSurrealQL({
      token,
      query: createQuery,
      logName: "categoryUsersAPI.POST /sql (create category user)",
    });

    if (!createResult.success) {
      return NextResponse.json({ error: "Failed to add user to category", details: createResult.error }, { status: 500 });
    }

    const created = getResultArray<{ id?: unknown }>(createResult.data[0]);
    if (created.length === 0) {
      return NextResponse.json({ error: "Permission denied: You don't have permission to add users to this category" }, { status: 403 });
    }

    return NextResponse.json({ success: true, id: thingIdToString(created[0].id) });
  } catch (error) {
    console.error("Error adding user to category:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT - Update user role
export async function PUT(req: NextRequest) {
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

    const body = await req.json();
    const { categoryUserId, role } = body;

    if (!categoryUserId || !role) {
      return NextResponse.json({ error: "Missing required fields: categoryUserId, role" }, { status: 400 });
    }

    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}` }, { status: 400 });
    }

    const categoryUserLiteral = toSurrealThingLiteral(categoryUserId);
    if (!categoryUserLiteral) {
      return NextResponse.json({ error: "Invalid categoryUserId" }, { status: 400 });
    }

    const updateQuery = `UPDATE ${categoryUserLiteral} SET role = ${JSON.stringify(role)};`;

    const updateResult = await executeSurrealQL({
      token,
      query: updateQuery,
      logName: "categoryUsersAPI.PUT /sql (update role)",
    });

    if (!updateResult.success) {
      return NextResponse.json({ error: "Failed to update role", details: updateResult.error }, { status: 500 });
    }

    // Check if the update actually modified a record
    const updated = getResultArray<{ id?: unknown }>(updateResult.data[0]);
    if (updated.length === 0) {
      return NextResponse.json({ error: "Category user not found or you don't have permission to update it" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating category user:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE - Remove user from category
export async function DELETE(req: NextRequest) {
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
    const categoryUserId = searchParams.get("categoryUserId");

    if (!categoryUserId) {
      return NextResponse.json({ error: "Missing categoryUserId parameter" }, { status: 400 });
    }

    const categoryUserLiteral = toSurrealThingLiteral(categoryUserId);
    if (!categoryUserLiteral) {
      return NextResponse.json({ error: "Invalid categoryUserId" }, { status: 400 });
    }

    const deleteQuery = `DELETE ${categoryUserLiteral};`;

    const deleteResult = await executeSurrealQL({
      token,
      query: deleteQuery,
      logName: "categoryUsersAPI.DELETE /sql (remove user)",
    });

    if (!deleteResult.success) {
      return NextResponse.json({ error: "Failed to remove user from category", details: deleteResult.error }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing user from category:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
