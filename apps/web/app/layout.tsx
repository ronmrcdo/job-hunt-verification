import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { FlowProvider } from "../lib/flow-context";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata = {
  title: "Job Hunt Verification",
  description: "Investigation report",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jetbrainsMono.variable}>
      <body>
        <FlowProvider>{children}</FlowProvider>
      </body>
    </html>
  );
}
