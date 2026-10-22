import { verifyUnsubscribe } from "@/lib/unsubscribe";
export const dynamic = "force-dynamic";
export default async function Unsubscribe({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  try {
    if (!token) throw Error();
    verifyUnsubscribe(token);
  } catch {
    return (
      <main className="standalone">
        <h1>This link is unavailable.</h1>
        <p>Use the unsubscribe link in your email, or contact the sender.</p>
      </main>
    );
  }
  return (
    <main className="standalone">
      <h1>A little less in your inbox.</h1>
      <p style={{ margin: "15px 0 25px" }}>
        Confirm below to stop all future outreach from this workspace.
      </p>
      <form
        action={"/api/unsubscribe?token=" + encodeURIComponent(token)}
        method="POST"
      >
        <button className="button button-primary">Unsubscribe</button>
      </form>
    </main>
  );
}
