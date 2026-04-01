import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/contexts/AppContext";
import { AppSidebar } from "@/components/AppSidebar";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Grupos OS - Planejamento de Viagens em Grupo",
  description: "Sistema de planejamento e precificação de grupos de viagens",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${inter.className} h-full antialiased`}>
      <body className="h-full bg-gray-50">
        <AppProvider>
          <div className="flex h-full">
            <AppSidebar />
            <div className="flex-1 overflow-hidden">{children}</div>
          </div>
        </AppProvider>
      </body>
    </html>
  );
}
