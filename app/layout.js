import "./globals.css";

export const metadata = {
  title: "Arch CRM — PE Outbound Tracker",
  description: "Track outbound to PE funds, platforms, and brands",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
