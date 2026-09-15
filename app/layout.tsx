import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProspecFlow — Veross",
  description: "Central de prospecção e pré-vendas da Veross.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
