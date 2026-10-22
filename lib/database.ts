import postgres from "postgres";
let client: ReturnType<typeof postgres> | undefined;
export function database() {
  if (!process.env.DATABASE_URL) throw Error("Setup required: DATABASE_URL");
  return (client ??= postgres(process.env.DATABASE_URL, {
    max: 6,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl:
      process.env.DATABASE_URL.includes("localhost") ||
      process.env.DATABASE_URL.includes("127.0.0.1")
        ? false
        : "require",
    onnotice: () => {},
  }));
}
