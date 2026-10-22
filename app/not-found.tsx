import Link from "next/link";
export default function NotFound() {
  return (
    <main className="standalone">
      <h1>That page has moved.</h1>
      <Link href="/">Return to your workspace</Link>
    </main>
  );
}
