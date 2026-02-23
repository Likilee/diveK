import type { Metadata } from "next";
import { Atkinson_Hyperlegible, Noto_Sans_KR } from "next/font/google";
import { Suspense } from "react";
import { RouteObserver } from "@/components/route-observer";
import "./globals.css";

const headingFont = Atkinson_Hyperlegible({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const bodyFont = Noto_Sans_KR({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "K-Context",
  description: "K-culture subtitle search MVP with mock data",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={`${headingFont.variable} ${bodyFont.variable}`}>
        <Suspense fallback={null}>
          <RouteObserver />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
