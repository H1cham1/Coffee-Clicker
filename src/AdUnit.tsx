import React, { useEffect } from "react";

declare global { interface Window { adsbygoogle: any[] } }

export default function AdUnit({
  slot,
  style = { display: "block" },
  format = "auto",
  responsive = "true",
}: {
  slot: string; // jouw data-ad-slot ID uit AdSense
  style?: React.CSSProperties;
  format?: string;
  responsive?: "true" | "false";
}) {
  useEffect(() => {
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch {}
  }, []);

  return (
    <ins
      className="adsbygoogle"
      style={style}
      data-ad-client="ca-pub-2801367195007587"
      data-ad-slot={slot}
      data-ad-format={format}
      data-full-width-responsive={responsive}
    />
  );
}
