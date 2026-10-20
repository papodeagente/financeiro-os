import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { AppProvider } from "@/contexts/AppContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { AppShell } from "@/components/AppShell";
import { Toaster } from "@/components/Toaster";

/**
 * Aeonik é a letra do Entur OS. Veio do CRM (client/public/fonts/aeonik)
 * para os dois sistemas terem a mesma voz — é o que mais pesa na semelhança,
 * mais do que a cor.
 *
 * ELA NÃO TEM PESO 600. Sem dizer isso ao navegador, todo `font-semibold`
 * do sistema seria sintetizado ou subiria para 700, engordando a interface
 * inteira. A hierarquia passa a ser de três níveis — 400, 500 e 700 — e
 * `--font-weight-semibold` em globals.css mapeia 600 para 500.
 */
const aeonik = localFont({
  src: [
    { path: "./fontes/Aeonik-Thin.woff2", weight: "100", style: "normal" },
    { path: "./fontes/Aeonik-ThinItalic.woff2", weight: "100", style: "italic" },
    { path: "./fontes/Aeonik-Air.woff2", weight: "200", style: "normal" },
    { path: "./fontes/Aeonik-AirItalic.woff2", weight: "200", style: "italic" },
    { path: "./fontes/Aeonik-Light.woff2", weight: "300", style: "normal" },
    { path: "./fontes/Aeonik-LightItalic.woff2", weight: "300", style: "italic" },
    { path: "./fontes/Aeonik-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fontes/Aeonik-RegularItalic.woff2", weight: "400", style: "italic" },
    { path: "./fontes/Aeonik-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fontes/Aeonik-MediumItalic.woff2", weight: "500", style: "italic" },
    { path: "./fontes/Aeonik-Bold.woff2", weight: "700", style: "normal" },
    { path: "./fontes/Aeonik-BoldItalic.woff2", weight: "700", style: "italic" },
    { path: "./fontes/Aeonik-Black.woff2", weight: "900", style: "normal" },
    { path: "./fontes/Aeonik-BlackItalic.woff2", weight: "900", style: "italic" },
  ],
  variable: "--font-aeonik",
  display: "swap",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Entur OS - Financeiro",
  description: "Sistema financeiro e gestão de agência de viagens",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${aeonik.variable} ${jetbrainsMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            var t = localStorage.getItem('entur-theme-v2') || 'light';
            if (t === 'dark') document.documentElement.classList.add('dark');
          })();
        `}} />
      </head>
      <body className="h-full bg-[var(--fin-bg)] text-[var(--fin-text)] transition-colors duration-200">
        <ThemeProvider>
          <AuthProvider>
            <AppProvider>
              <AppShell>{children}</AppShell>
              <Toaster />
            </AppProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
