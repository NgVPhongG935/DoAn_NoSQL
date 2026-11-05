import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, BadgeCheck, Bike, CarFront, Clock3, CreditCard, MapPin, MoveRight, ShieldCheck, Sparkles, Star } from "lucide-react";

const services = [
  { title: "Di chuyển hai bánh", note: "Linh hoạt giữa phố đông", icon: Bike },
  { title: "Ô tô cá nhân", note: "Thoải mái cho hành trình", icon: CarFront },
  { title: "Chuyến đi cao cấp", note: "Một trải nghiệm chỉn chu", icon: Sparkles },
];

export function LandingPage() {
  return <main className="landing">
    <nav className="site-nav">
      <Link className="brand" href="/" aria-label="RideFlow trang chủ"><span className="brand-mark"><MoveRight size={20} strokeWidth={2.8} /></span><span>rideflow<span className="brand-period">.</span></span></Link>
      <div className="nav-links"><a href="#dich-vu">Dịch vụ</a><a href="#loi-ich">Vì sao RideFlow</a><a href="#cach-dat">Cách đặt xe</a></div>
      <div className="nav-actions"><Link href="/login" className="nav-login">Đăng nhập</Link><Link href="/login" className="button button-dark button-small">Bắt đầu <ArrowUpRight size={15} /></Link></div>
    </nav>

    <section className="hero-section">
      <div className="hero-copy">
        <div className="eyebrow"><span className="eyebrow-dot" /> ĐI CHUYỂN THEO CÁCH CỦA BẠN</div>
        <h1>Thành phố rộng mở.<br /><em>Chuyến đi</em> thật nhẹ nhàng.</h1>
        <p>Đặt một chuyến xe chỉ trong vài chạm. RideFlow kết nối bạn với hành trình tiện lợi, minh bạch và thoải mái hơn mỗi ngày.</p>
        <div className="hero-actions"><Link href="/login" className="button button-gold">Đặt xe ngay <ArrowRight size={17} /></Link><a href="#dich-vu" className="text-link">Khám phá dịch vụ <ArrowDownRight size={16} /></a></div>
        <div className="hero-proof"><span className="proof-seal"><ShieldCheck size={16} /></span><div><div className="proof-stars"><strong>RideFlow Demo</strong></div><small>Minh họa quy trình đặt xe trên Cassandra</small></div></div>
      </div>
      <div className="hero-visual" aria-label="Bản đồ minh họa hành trình RideFlow">
        <div className="map-grid" /><div className="map-river" /><div className="map-road road-one" /><div className="map-road road-two" /><div className="map-road road-three" />
        <div className="map-label map-label-one">THẢO ĐIỀN</div><div className="map-label map-label-two">QUẬN 1</div><div className="map-label map-label-three">BẾN THÀNH</div>
        <div className="map-route"><span className="route-start" /><i /><i /><i /><i /><span className="route-end"><MapPin size={18} fill="currentColor" /></span></div>
        <div className="map-pill"><span className="live-dot" /> Bản đồ minh họa <strong>HCMC</strong></div><div className="map-car"><CarFront size={18} /><span>RideFlow</span></div>
        <div className="booking-peek"><div className="peek-top"><span className="peek-icon"><MapPin size={17} /></span><div><small>ĐIỂM ĐÓN</small><strong>Thảo Điền, TP. Thủ Đức</strong></div><ArrowUpRight size={16} /></div><div className="peek-divider" /><div className="peek-bottom"><div><small>ĐIỂM ĐẾN</small><strong>Nhà thờ Đức Bà</strong></div><span className="peek-time"><Clock3 size={14} /> 18 phút</span></div><Link href="/login" className="button button-gold peek-button">Tìm chuyến xe <ArrowRight size={16} /></Link></div>
        <div className="map-caption"><span>01</span><span>HÀNH TRÌNH CỦA BẠN, THEO CÁCH RIÊNG</span></div>
      </div>
      <div className="hero-bottom-note"><span>THÀNH PHỐ HỒ CHÍ MINH</span><span>10°48' N&nbsp; 106°42' E</span></div>
    </section>

    <section className="service-section section-wrap" id="dich-vu">
      <div className="section-heading"><div><span className="section-kicker">CHỌN CHUYẾN ĐI</span><h2>Một RideFlow cho<br /><em>mọi hành trình.</em></h2></div><p>Từ quãng đường thật ngắn đến một ngày cần thêm chút thoải mái. Chọn dịch vụ phù hợp với nhịp sống của bạn.</p></div>
      <div className="service-grid">{services.map(({ title, note, icon: Icon }, index) => <article className={`service-card service-card-${index + 1}`} key={title}><div className="service-card-top"><span className="service-icon"><Icon size={22} /></span><span className="service-index">0{index + 1}</span></div><h3>{title}</h3><p>{note}</p><div className="service-card-bottom"><span>Dịch vụ RideFlow</span><ArrowUpRight size={17} /></div></article>)}</div>
    </section>

    <section className="benefit-section" id="loi-ich"><div className="benefit-inner"><div className="benefit-stamp"><ShieldCheck size={23} /><span>RIDEFLOW<br />PROMISE</span></div><div className="benefit-title"><span className="section-kicker">ĐIỀU QUAN TRỌNG NHẤT</span><h2>Thoải mái từ lúc<br /><em>bắt đầu chuyến đi.</em></h2></div><div className="benefit-list"><div><BadgeCheck size={19} /><span><strong>Giá rõ ràng</strong><small>Ước tính trước khi bạn xác nhận</small></span></div><div><Clock3 size={19} /><span><strong>Đón đúng hẹn</strong><small>Theo dõi trạng thái chuyến</small></span></div><div><CreditCard size={19} /><span><strong>Thanh toán linh hoạt</strong><small>Chọn phương thức phù hợp</small></span></div></div></div></section>

    <section className="steps-section section-wrap" id="cach-dat"><div className="section-heading"><div><span className="section-kicker">CHỈ BA BƯỚC ĐƠN GIẢN</span><h2>Từ đây đến đó,<br /><em>thật dễ dàng.</em></h2></div><Link href="/login" className="text-link">Bắt đầu hành trình <ArrowRight size={16} /></Link></div><div className="steps-grid"><div className="step-item"><span>01</span><MapPin size={21} /><h3>Chọn điểm đến</h3><p>Cho RideFlow biết bạn đang ở đâu và muốn đi đâu.</p></div><div className="step-connector"><i /><i /><i /><i /></div><div className="step-item"><span>02</span><CarFront size={21} /><h3>Chọn chuyến xe</h3><p>Xem lựa chọn dịch vụ và giá ước tính minh bạch.</p></div><div className="step-connector"><i /><i /><i /><i /></div><div className="step-item"><span>03</span><Star size={21} /><h3>Tận hưởng hành trình</h3><p>Theo dõi chuyến đi và chia sẻ đánh giá khi đến nơi.</p></div></div></section>

    <section className="cta-section"><div className="cta-orbit orbit-a" /><div className="cta-orbit orbit-b" /><span className="section-kicker">SẴN SÀNG LĂN BÁNH?</span><h2>Điều hay ho đang<br />ở <em>phía trước.</em></h2><Link href="/login" className="button button-dark">Đặt chuyến đầu tiên <ArrowUpRight size={17} /></Link><span className="cta-coordinate">RIDEFLOW · HCMC · VN</span></section>
    <footer className="site-footer"><Link className="brand" href="/"><span className="brand-mark"><MoveRight size={18} strokeWidth={2.8} /></span><span>rideflow<span className="brand-period">.</span></span></Link><p>Di chuyển thông minh, hành trình dễ dàng.</p><div><a href="#dich-vu">Dịch vụ</a><Link href="/login">Đăng nhập</Link><span>© 2026 RideFlow</span></div></footer>
  </main>;
}