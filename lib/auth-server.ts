import { createNeonAuth } from "@neondatabase/auth/next/server";

export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL || "http://localhost:3000/api/auth",
  cookies: { secret: process.env.NEON_AUTH_COOKIE_SECRET || "prospecflow-demo-cookie-secret-32-chars" },
});

export const isNeonConfigured = Boolean(
  process.env.DATABASE_URL &&
  process.env.NEON_AUTH_BASE_URL &&
  process.env.NEON_AUTH_COOKIE_SECRET,
);
