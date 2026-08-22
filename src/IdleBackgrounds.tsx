import { invoke } from "@tauri-apps/api/core";
import { FishSymbol, Images, LayoutGrid, Map as MapIcon, MousePointer2, Waves } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { InteractiveMap } from "./InteractiveMap";

export type IdleBackgroundKind = "waves" | "fish" | "reactive" | "topographic" | "slideshow";
export type IdleLocation = { name: string; latitude: number; longitude: number };

const BACKGROUNDS: { id: IdleBackgroundKind; label: string; icon: typeof Waves }[] = [
  { id: "waves", label: "Waves", icon: Waves },
  { id: "fish", label: "Fish pond", icon: FishSymbol },
  { id: "reactive", label: "Reactive", icon: MousePointer2 },
  { id: "topographic", label: "Topographic", icon: MapIcon },
  { id: "slideshow", label: "Slideshow", icon: Images },
];

const FISH = [
  ["Orange roughy", "#ef7d2a", 10, 16, 23], ["Blue cod", "#478ecb", 28, 11, 19],
  ["Snapper", "#ef6372", 45, 20, 25], ["Sea perch", "#e1b04b", 63, 13, 21],
  ["Gemfish", "#aebdca", 79, 18, 28], ["Blue cod", "#3679b7", 91, 8, 24],
  ["Snapper", "#d94c62", 17, 28, 22], ["Orange roughy", "#dc6824", 72, 30, 26],
] as const;

export function IdleDashboard({
  kind,
  location,
  slideshowFolder,
  contentVisible,
  onKindChange,
}: {
  kind: IdleBackgroundKind;
  location?: IdleLocation;
  slideshowFolder?: string;
  contentVisible: boolean;
  onKindChange: (kind: IdleBackgroundKind) => void;
}) {
  return (
    <div className={`empty-dashboard idle-background-${kind}`} data-idle-background={kind}>
      <IdleVisual kind={kind} location={location} slideshowFolder={slideshowFolder} />
      <div className={`empty-dashboard-content ${contentVisible ? "" : "is-hidden"}`}>
        <span className="empty-dashboard-icon"><LayoutGrid size={34} /></span>
        <strong>No widgets open</strong>
        <span>Use the left rail to show an available widget.</span>
      </div>
      <nav className="idle-background-picker" aria-label="No widgets background">
        {BACKGROUNDS.map(({ id, label, icon: Icon }) => (
          <button key={id} className={kind === id ? "selected" : ""} aria-pressed={kind === id} onClick={() => onKindChange(id)} title={label}>
            <Icon size={16} /><span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function IdleVisual({ kind, location, slideshowFolder }: { kind: IdleBackgroundKind; location?: IdleLocation; slideshowFolder?: string }) {
  if (kind === "fish") return <FishPond />;
  if (kind === "reactive") return <ReactiveSea />;
  if (kind === "topographic") return <TopographicBackground location={location} />;
  if (kind === "slideshow") return <SlideshowBackground folder={slideshowFolder} />;
  return <WaveBackground />;
}

function WaveBackground() {
  const paths = [
    "M -120 280 C 160 120 340 390 620 238 S 1040 116 1320 286 S 1710 346 1840 194",
    "M -160 350 C 120 190 376 428 650 304 S 1010 206 1286 334 S 1700 424 1860 276",
    "M -180 210 C 110 74 350 300 590 182 S 970 86 1230 218 S 1630 298 1830 138",
    "M -130 426 C 180 296 390 494 650 400 S 1040 300 1310 430 S 1660 494 1840 376",
    "M -180 142 C 120 30 380 210 610 116 S 1000 22 1270 152 S 1660 216 1830 88",
    "M -150 78 C 130 -20 360 150 620 72 S 1010 -6 1278 96 S 1620 172 1840 42",
    "M -170 482 C 100 368 380 552 642 468 S 1018 382 1288 496 S 1668 558 1852 438",
    "M -160 316 C 146 218 346 414 606 328 S 984 236 1254 346 S 1612 420 1848 296",
    "M -140 246 C 106 164 328 330 584 254 S 968 168 1218 266 S 1638 360 1842 230",
  ];
  return <div className="empty-wave-field" aria-hidden="true"><svg className="empty-wave-svg" viewBox="0 0 1600 520" preserveAspectRatio="none">{paths.map((path, index) => <path key={path} className={`empty-wave-line wave-${["one","two","three","four","five","six","seven","eight","nine"][index]}`} pathLength="1" d={path} />)}</svg></div>;
}

function FishPond() {
  return <div className="pixel-fish-pond" aria-label="Pixel fish pond">{FISH.map(([species, colour, top, delay, duration], index) => (
    <span className="pixel-fish-lane" key={`${species}-${index}`} style={{ top: `${top}%`, animationDelay: `-${delay}s`, animationDuration: `${duration}s` }}>
      <svg className="pixel-fish" viewBox="0 0 48 24" role="img" aria-label={species} style={{ color: colour }} shapeRendering="crispEdges">
        <path fill="currentColor" d="M4 4h6v4h5V5h19v3h5v3h5v2h-5v3h-5v3H15v-3h-5v4H4v-6H0v-4h4z" />
        <path fill="rgba(255,255,255,.58)" d="M16 8h14v3H16z" /><path fill="#111923" d="M34 8h3v3h-3z" />
      </svg>
    </span>
  ))}<i className="pond-lily lily-one" /><i className="pond-lily lily-two" /></div>;
}

function ReactiveSea() {
  const [pointer, setPointer] = useState({ x: -1, y: -1 });
  const points = useMemo(() => Array.from({ length: 216 }, (_, index) => ({ x: (index % 24) / 23, y: Math.floor(index / 24) / 8 })), []);
  return <div className="reactive-sea" aria-label="Interactive sea of dots" onPointerMove={(event) => { const box = event.currentTarget.getBoundingClientRect(); setPointer({ x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height }); }} onPointerLeave={() => setPointer({ x: -1, y: -1 })}>
    {points.map((point, index) => { const distance = Math.hypot(point.x - pointer.x, point.y - pointer.y); const pressure = pointer.x < 0 ? 0 : Math.max(0, 1 - distance / .18); const angle = Math.atan2(point.y - pointer.y, point.x - pointer.x); return <i key={index} style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%`, transform: `translate(${Math.cos(angle) * pressure * 26}px, ${Math.sin(angle) * pressure * 26}px) scale(${1 - pressure * .68})`, animationDelay: `${-(index % 17) * .13}s` }} />; })}
  </div>;
}

function TopographicBackground({ location }: { location?: IdleLocation }) {
  const origin = location || { name: "Melbourne", latitude: -37.8136, longitude: 144.9631 };
  const [center, setCenter] = useState({ latitude: origin.latitude, longitude: origin.longitude });
  useEffect(() => { setCenter({ latitude: origin.latitude, longitude: origin.longitude }); }, [origin.latitude, origin.longitude]);
  useEffect(() => { const timer = window.setInterval(() => setCenter((value) => ({ latitude: value.latitude + .0007, longitude: value.longitude + .0024 })), 700); return () => window.clearInterval(timer); }, []);
  return <div className="idle-topographic-map"><InteractiveMap center={center} zoom={9} onViewChange={setCenter} interactive={false} showControls={false} monochrome baseTileUrl={(zoom, x, y) => `https://tile.opentopomap.org/${zoom}/${x}/${y}.png`} attribution="© OpenStreetMap contributors · OpenTopoMap" /></div>;
}

function SlideshowBackground({ folder }: { folder?: string }) {
  const [images, setImages] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [dataUrl, setDataUrl] = useState("");
  useEffect(() => {
    setImages([]); setIndex(0); setDataUrl("");
    if (!folder || !("__TAURI_INTERNALS__" in window)) return;
    invoke<string[]>("list_slideshow_images", { folder }).then(setImages).catch(() => setImages([]));
  }, [folder]);
  useEffect(() => { if (images.length < 2) return; const timer = window.setInterval(() => setIndex((value) => (value + 1) % images.length), 8000); return () => window.clearInterval(timer); }, [images]);
  useEffect(() => { if (!images[index]) return; invoke<string>("read_slideshow_image", { path: images[index] }).then(setDataUrl).catch(() => setDataUrl("")); }, [images, index]);
  if (!folder) return <div className="idle-slideshow-message"><Images size={42} /><strong>Please select an album folder from the settings menu</strong></div>;
  if (!images.length) return <div className="idle-slideshow-message"><Images size={42} /><strong>No supported images were found in the selected album folder</strong></div>;
  return <div className="idle-slideshow">{dataUrl ? <img src={dataUrl} alt="Album slideshow" /> : null}</div>;
}
