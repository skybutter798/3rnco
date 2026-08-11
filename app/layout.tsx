import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./production.css";

const siteUrl = "https://3rnco.com.my";
const socialImage = `${siteUrl}/og-3rnco-moringa-1200x630.jpg`;

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${siteUrl}/#organization`,
      name: "3R&Co",
      alternateName: "3R & Co.",
      url: `${siteUrl}/`,
      logo: `${siteUrl}/images/brand/3rnco-logo.png`,
      description:
        "A Malaysian body-care brand creating moringa-led oils, creams and cleansing rituals.",
      email: "support@3rnco.com.my",
      telephone: "+60177816398",
      sameAs: [
        "https://www.instagram.com/3rnco",
        "https://www.facebook.com/officially3randco/",
      ],
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "customer care",
        telephone: "+60177816398",
        email: "support@3rnco.com.my",
        areaServed: "MY",
        availableLanguage: "English",
      },
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      url: `${siteUrl}/`,
      name: "3R&Co Malaysia",
      description: "Moringa-led body oil, body cream and cleansing care.",
      inLanguage: "en-MY",
      publisher: { "@id": `${siteUrl}/#organization` },
    },
    {
      "@type": "WebPage",
      "@id": `${siteUrl}/#webpage`,
      url: `${siteUrl}/`,
      name: "3R&Co Malaysia | Moringa Body Oil & Body Care",
      isPartOf: { "@id": `${siteUrl}/#website` },
      about: { "@id": `${siteUrl}/#organization` },
      primaryImageOfPage: {
        "@type": "ImageObject",
        url: socialImage,
        width: 1200,
        height: 630,
      },
      inLanguage: "en-MY",
    },
  ],
};

export const viewport: Viewport = {
  themeColor: "#f2e8d8",
  colorScheme: "light",
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "3R&Co Malaysia | Moringa Body Oil & Body Care",
  description:
    "Discover 3R&Co Malaysia's moringa-led body ritual: Tree Body Oil, Body Cream, Champion Soap and travel care for slow everyday wellbeing.",
  applicationName: "3R&Co Malaysia",
  creator: "3R&Co",
  publisher: "3R&Co",
  category: "Body care",
  keywords: [
    "3R&Co Malaysia",
    "moringa body oil",
    "moringa body cream",
    "body oil Malaysia",
    "natural body care Malaysia",
    "handmade soap Malaysia",
    "Tree Body Oil",
    "Champion Soap",
  ],
  alternates: {
    canonical: `${siteUrl}/`,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  manifest: "/site.webmanifest",
  appleWebApp: {
    capable: true,
    title: "3R&Co",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [{ url: "/images/brand/3rnco-logo.png", type: "image/png" }],
    shortcut: "/images/brand/3rnco-logo.png",
    apple: "/images/brand/3rnco-logo.png",
  },
  openGraph: {
    type: "website",
    locale: "en_MY",
    url: `${siteUrl}/`,
    siteName: "3R&Co Malaysia",
    title: "Come home to care | 3R&Co Malaysia",
    description:
      "Born from family care in 2019, 3R&Co creates moringa-led body rituals to relieve, restore and bring you gently back to yourself.",
    images: [
      {
        url: socialImage,
        secureUrl: socialImage,
        width: 1200,
        height: 630,
        type: "image/jpeg",
        alt: "3R&Co Tree Body Oil and Body Cream surrounded by fresh moringa leaves",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Come home to care | 3R&Co Malaysia",
    description:
      "Moringa-led body care, born from family care and made to relieve, restore and rejuvenate.",
    images: [socialImage],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-MY">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
