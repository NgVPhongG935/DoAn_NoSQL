import Link from "next/link";
import { CarFront } from "lucide-react";

type RideLoaderProps = {
  label?: string;
  variant?: "page" | "panel" | "inline";
};

export function RideLoader({ label = "Đang tải dữ liệu...", variant = "panel" }: RideLoaderProps) {
  const road = <div className="ride-loader-track" aria-hidden="true">
    <span className="ride-loader-lane" />
    <span className="ride-loader-car"><CarFront size={24} strokeWidth={2.3} /></span>
    <span className="ride-loader-destination" />
  </div>;

  if (variant === "page") {
    return <main className="ride-loader-page" role="status" aria-live="polite">
      <Link href="/" className="brand ride-loader-brand"><span className="brand-mark"><CarFront size={19} /></span><span>rideflow<span className="brand-period">.</span></span></Link>
      <div className="ride-loader-page-content">{road}<p>{label}</p><small>Đang kết nối hành trình của bạn</small></div>
    </main>;
  }

  return <div className={`ride-loader ride-loader-${variant}`} role="status" aria-live="polite">
    {road}<span>{label}</span>
  </div>;
}