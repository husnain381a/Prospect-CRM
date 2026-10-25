import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
const inter = localFont({
  src: "../public/fonts/inter-variable.ttf",
  variable: "--font-inter",
  display: "swap",
  weight: "100 900",
});
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
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
