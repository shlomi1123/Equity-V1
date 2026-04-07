import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Equity Close OS",
  description: "CSV-first mapping and import studio for equity close operations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
