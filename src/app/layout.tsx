import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import "./ride-loader.css";
import "./booking-fix.css";
import "./pink-theme.css";
import "./booking-layout.css";
import "./account-management.css";
import "./driver-registration.css";
import "./admin-management.css";

export const metadata: Metadata = {
  title: "RideFlow | Di chuyển thông minh",
  description: "Ứng dụng đặt xe minh họa quản trị dữ liệu Cassandra.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Browser extensions can add attributes such as `mdl-js` before hydration.
  // Tolerate attributes on this root only; retain checks inside the application.
  return <html lang="vi" data-scroll-behavior="smooth" suppressHydrationWarning><body>{children}</body></html>;
}
