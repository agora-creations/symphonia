import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Agentation } from "agentation";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Symphonia",
  description: "Local-first orchestration control plane for coding-agent work.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark" style={{ colorScheme: "dark" }} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('symphonia-theme')||'dark';var r=document.documentElement;if(t==='light'){r.classList.remove('dark');r.style.colorScheme='light';}else{r.classList.add('dark');r.style.colorScheme='dark';}}catch(e){}",
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
        {process.env.NODE_ENV === "development" && <Agentation endpoint="http://localhost:4747" />}
      </body>
    </html>
  );
}
