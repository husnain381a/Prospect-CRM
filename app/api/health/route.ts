export async function GET() {
  return Response.json(
    {
      status: "ok",
      service: "prospect-web",
      configured: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      version: "1.0.0",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
