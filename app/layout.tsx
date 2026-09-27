import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { BRAND_NAME, BRAND_TITLE } from "../lib/brand";
import { requestOrigin } from "../lib/request-origin";

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const siteUrl = new URL(requestOrigin(requestHeaders));
  const title = BRAND_TITLE;
  const description = "一起阅读、炼化心结、贡献订阅源，发现值得长期关注的 RSS、X 与公众号内容。";
  const image = new URL("/og-community.png", siteUrl).toString();

  return {
    metadataBase: siteUrl,
    title,
    description,
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title,
      description,
      url: "/",
      siteName: BRAND_NAME,
      locale: "zh_CN",
      type: "website",
      images: [{ url: image, width: 1728, height: 910, alt: `${BRAND_NAME}的阅读与贡献排行榜` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
