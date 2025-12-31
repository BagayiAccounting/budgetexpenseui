"use client";

export default function LoginButton() {
  const audience = process.env.NEXT_PUBLIC_AUTH0_AUDIENCE;
  const scope = process.env.NEXT_PUBLIC_AUTH0_SCOPE;

  const params = new URLSearchParams({
    returnTo: "/dashboard",
    ...(audience ? { audience } : {}),
    ...(scope ? { scope } : {}),
  });

  return (
    <a
      href={`/auth/login?${params.toString()}`}
      className="button login"
    >
      Log In
    </a>
  );
}