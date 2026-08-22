import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { FlowProvider } from "../lib/flow-context";
import { CookieBanner } from "../components/site/CookieBanner";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata = {
  title: "Jobverifai",
  description: "Investigation report",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-scroll-behavior tells Next to suspend the CSS smooth scroll during
    // SPA route transitions (docs/01-app/02-guides/upgrading/version-16.md),
    // so only in-page anchor jumps (header's How it works / Risk bands) glide.
    <html lang="en" data-scroll-behavior="smooth" className={jetbrainsMono.variable}>
      <body>
        <FlowProvider>{children}</FlowProvider>
        <CookieBanner />
      </body>
    </html>
  );
}
