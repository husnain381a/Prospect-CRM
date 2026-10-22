import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Prospect — Your next opportunity, closer.",
  description:
    "Discover businesses, build relationships, and turn your next opportunity into a customer.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
