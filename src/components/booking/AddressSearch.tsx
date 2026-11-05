"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, LocateFixed, MapPin, Navigation, Search, X } from "lucide-react";
import type { MapPoint } from "@/lib/map-types";

export function AddressSearch({
  kind,
  value,
  selected,
  disabled,
  locating,
  onTextChange,
  onSelect,
  onCurrentLocation,
}: {
  kind: "pickup" | "destination";
  value: string;
  selected: boolean;
  disabled?: boolean;
  locating?: boolean;
  onTextChange: (value: string) => void;
  onSelect: (place: MapPoint) => void;
  onCurrentLocation?: () => void;
}) {
  const [suggestions, setSuggestions] = useState<MapPoint[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const requestId = useRef(0);

  useEffect(() => {
    if (selected || value.trim().length < 3) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    const currentRequest = ++requestId.current;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setSearching(true);
      setMessage("");
      fetch(`/api/maps/geocode?q=${encodeURIComponent(value.trim())}`, { signal: controller.signal, cache: "no-store" })
        .then(async (response) => {
          const body = await response.json();
          if (!response.ok || !body.success) throw new Error(body.message || "Không tìm được địa chỉ.");
          return body.data as MapPoint[];
        })
        .then((items) => {
          if (requestId.current !== currentRequest) return;
          setSuggestions(items);
          setOpen(true);
          setMessage(items.length ? "" : "Không tìm thấy địa chỉ phù hợp.");
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || requestId.current !== currentRequest) return;
          setSuggestions([]);
          setOpen(true);
          setMessage(error instanceof Error ? error.message : "Không tìm được địa chỉ.");
        })
        .finally(() => { if (requestId.current === currentRequest) setSearching(false); });
    }, 450);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [selected, value]);

  const Icon = kind === "pickup" ? MapPin : Navigation;
  const label = kind === "pickup" ? "Điểm đón" : "Điểm đến";

  return <div className="form-field address-search-field">
    <div className="address-label-row"><label htmlFor={`address-${kind}`}>{label}</label>{onCurrentLocation && <button type="button" className="current-location-button" disabled={disabled || locating} onClick={onCurrentLocation}>{locating ? <LoaderCircle className="spin" size={14} /> : <LocateFixed size={14} />} Vị trí hiện tại</button>}</div>
    <div className={`input-icon address-search-input ${selected ? "is-selected" : ""}`}>
      <Icon size={17} />
      <input
        id={`address-${kind}`}
        value={value}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(event) => { onTextChange(event.target.value); setOpen(true); }}
        required
        minLength={3}
        maxLength={180}
        autoComplete="off"
        placeholder={kind === "pickup" ? "Nhập địa chỉ đón" : "Bạn muốn đến đâu?"}
      />
      {searching ? <LoaderCircle className="spin address-search-state" size={16} /> : value ? <button type="button" className="address-clear" aria-label={`Xóa ${label.toLowerCase()}`} onClick={() => onTextChange("")}><X size={15} /></button> : <Search className="address-search-state" size={15} />}
    </div>
    {open && !selected && (suggestions.length > 0 || message) && <div className="address-suggestions">
      {suggestions.map((item, index) => <button type="button" key={`${item.lat}-${item.lng}-${index}`} onMouseDown={(event) => event.preventDefault()} onClick={() => { onSelect(item); setOpen(false); setSuggestions([]); }}><span><MapPin size={16} /></span><strong>{item.label}</strong></button>)}
      {message && <div className="address-empty">{message}</div>}
    </div>}
  </div>;
}
