import { invoke } from "@tauri-apps/api/core";
import { FishSymbol, Images, LayoutGrid, Map as MapIcon, Sparkles, Waves } from "lucide-react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { InteractiveMap } from "./InteractiveMap";

export type IdleBackgroundKind = "waves" | "fish" | "stars" | "topographic" | "slideshow";
export type SlideshowFit = "crop" | "contain";
export type IdleLocation = { name: string; latitude: number; longitude: number };

const BACKGROUNDS: { id: IdleBackgroundKind; label: string; icon: typeof Waves }[] = [
  { id: "waves", label: "Waves", icon: Waves },
  { id: "fish", label: "Fish pond", icon: FishSymbol },
  { id: "stars", label: "Stars", icon: Sparkles },
  { id: "topographic", label: "Topographic", icon: MapIcon },
  { id: "slideshow", label: "Slideshow", icon: Images },
];

const FISH = [
  { species: "Orange roughy", path: "path-a", top: 8, delay: 16, duration: 34, scale: .9 },
  { species: "Blue cod", path: "path-b reverse", top: 27, delay: 11, duration: 39, scale: 1.04 },
  { species: "Snapper", path: "path-c", top: 44, delay: 20, duration: 31, scale: .94 },
  { species: "Sea perch", path: "path-d reverse", top: 62, delay: 13, duration: 37, scale: .88 },
  { species: "Gemfish", path: "path-b", top: 77, delay: 18, duration: 42, scale: 1.08 },
  { species: "Blue cod", path: "path-d", top: 89, delay: 8, duration: 36, scale: .82 },
  { species: "Snapper", path: "path-a reverse", top: 18, delay: 28, duration: 40, scale: .74 },
  { species: "Orange roughy", path: "path-c reverse", top: 70, delay: 30, duration: 38, scale: .76 },
  { species: "Sea perch", path: "path-b", top: 36, delay: 25, duration: 44, scale: .68 },
] as const;

export function IdleDashboard({
  kind,
  location,
  slideshowFolder,
  slideshowFit = "crop",
  contentVisible,
  onKindChange,
}: {
  kind: IdleBackgroundKind;
  location?: IdleLocation;
  slideshowFolder?: string;
  slideshowFit?: SlideshowFit;
  contentVisible: boolean;
  onKindChange: (kind: IdleBackgroundKind) => void;
}) {
  const [pickerVisible, setPickerVisible] = useState(true);
  const pickerTimer = useRef<number | null>(null);
  const keepPickerVisible = () => {
    if (pickerTimer.current !== null) window.clearTimeout(pickerTimer.current);
    setPickerVisible(true);
  };
  const schedulePickerHide = () => {
    if (pickerTimer.current !== null) window.clearTimeout(pickerTimer.current);
    pickerTimer.current = window.setTimeout(() => setPickerVisible(false), 3_000);
  };
  useEffect(() => { schedulePickerHide(); return () => { if (pickerTimer.current !== null) window.clearTimeout(pickerTimer.current); }; }, []);
  return (
    <div className={`empty-dashboard idle-background-${kind}`} data-idle-background={kind}>
      <IdleVisual kind={kind} location={location} slideshowFolder={slideshowFolder} slideshowFit={slideshowFit} />
      <div className={`empty-dashboard-content ${contentVisible && !(kind === "slideshow" && !slideshowFolder) ? "" : "is-hidden"}`}>
        <span className="empty-dashboard-icon"><LayoutGrid size={34} /></span>
        <strong>No widgets open</strong>
        <span>Use the left rail to show an available widget.</span>
      </div>
      <nav className={`idle-background-picker ${pickerVisible ? "is-visible" : ""}`} aria-label="No widgets background" onPointerEnter={keepPickerVisible} onPointerLeave={schedulePickerHide} onFocus={keepPickerVisible} onBlur={schedulePickerHide}>
        {BACKGROUNDS.map(({ id, label, icon: Icon }) => (
          <button key={id} className={kind === id ? "selected" : ""} aria-pressed={kind === id} onPointerUp={(event) => event.currentTarget.blur()} onClick={() => { onKindChange(id); keepPickerVisible(); schedulePickerHide(); }} title={label}>
            <Icon size={16} /><span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function IdleVisual({ kind, location, slideshowFolder, slideshowFit }: { kind: IdleBackgroundKind; location?: IdleLocation; slideshowFolder?: string; slideshowFit: SlideshowFit }) {
  if (kind === "fish") return <FishPond />;
  if (kind === "stars") return <StarField location={location} />;
  if (kind === "topographic") return <TopographicBackground location={location} />;
  if (kind === "slideshow") return <SlideshowBackground folder={slideshowFolder} fit={slideshowFit} />;
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
  const pondRef = useRef<HTMLDivElement>(null);
  const fishNodes = useRef<(HTMLSpanElement | null)[]>([]);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const [food, setFood] = useState<{ id: number; x: number; y: number }[]>([]);
  const foodRef = useRef(food);
  const motion = useRef(FISH.map((_, index) => ({ x: .08 + (index * .113) % .82, y: .12 + (index * .197) % .76, vx: 18 + index * 2.2, vy: Math.sin(index * 2.7) * 13, phase: index * 1.73 })));
  const replaceFood = (update: (items: typeof food) => typeof food) => setFood((items) => { const next = update(items); foodRef.current = next; return next; });
  function pondPoint(event: ReactPointerEvent<HTMLDivElement>) { const bounds = event.currentTarget.getBoundingClientRect(); return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }; }
  function dropFood(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const item = { id: Date.now(), x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height };
    replaceFood((items) => [...items.slice(-3), item]);
    window.setTimeout(() => replaceFood((items) => items.filter((candidate) => candidate.id !== item.id)), 12_000);
  }
  useEffect(() => {
    let frame = 0;
    let previous = performance.now();
    const clearPointer = () => { pointer.current = null; };
    window.addEventListener("blur", clearPointer);
    const animate = (now: number) => {
      const pond = pondRef.current;
      if (!pond) return;
      const bounds = pond.getBoundingClientRect();
      const width = Math.max(1, bounds.width);
      const height = Math.max(1, bounds.height);
      const dt = Math.min(.035, Math.max(.005, (now - previous) / 1000));
      previous = now;
      const motions = motion.current;
      const eaten = new Set<number>();
      motions.forEach((fish, index) => {
        if (fish.x <= 1 && fish.y <= 1) { fish.x *= width; fish.y *= height; }
        const nearestFood = foodRef.current.map((item) => ({ ...item, px: item.x * width, py: item.y * height, distance: Math.hypot(item.x * width - fish.x, item.y * height - fish.y) })).sort((a, b) => a.distance - b.distance)[0];
        const target = nearestFood ? { x: nearestFood.px, y: nearestFood.py, food: nearestFood } : pointer.current ? { ...pointer.current, food: null } : null;
        let ax = Math.sin(now / 1700 + fish.phase) * 13;
        let ay = Math.cos(now / 2100 + fish.phase * 1.4) * 11;
        let behaviour = "wandering";
        if (target) {
          const dx = target.x - fish.x;
          const dy = target.y - fish.y;
          const distance = Math.max(1, Math.hypot(dx, dy));
          const orbitRadius = target.food ? 18 : 44 + index % 4 * 9;
          const speed = target.food ? 76 + index * 2 : 55 + index * 1.7;
          if (!target.food && distance <= orbitRadius * 1.35) {
            const direction = index % 2 ? -1 : 1;
            const radialError = distance - orbitRadius;
            const desiredX = (-dy / distance * direction - dx / distance * radialError * .035) * speed;
            const desiredY = (dx / distance * direction - dy / distance * radialError * .035) * speed;
            ax += (desiredX - fish.vx) * 1.4;
            ay += (desiredY - fish.vy) * 1.4;
            behaviour = "circling-cursor";
          } else {
            const desiredX = dx / distance * speed;
            const desiredY = dy / distance * speed;
            ax += (desiredX - fish.vx) * (target.food ? 2.1 : 1.25);
            ay += (desiredY - fish.vy) * (target.food ? 2.1 : 1.25);
            behaviour = target.food ? "seeking-food" : "seeking-cursor";
          }
          if (target.food && distance < 30) eaten.add(target.food.id);
        }
        motions.forEach((other, otherIndex) => {
          if (otherIndex === index || other.x <= 1) return;
          const dx = fish.x - other.x;
          const dy = fish.y - other.y;
          const distance = Math.max(1, Math.hypot(dx, dy));
          if (distance < 74) { const strength = (74 - distance) / 74 * 24; ax += dx / distance * strength; ay += dy / distance * strength; }
        });
        const margin = 46;
        if (fish.x < margin) ax += (margin - fish.x) * 2.4;
        if (fish.x > width - margin - 86) ax -= (fish.x - (width - margin - 86)) * 2.4;
        if (fish.y < margin) ay += (margin - fish.y) * 2.4;
        if (fish.y > height - margin - 38) ay -= (fish.y - (height - margin - 38)) * 2.4;
        fish.vx += ax * dt;
        fish.vy += ay * dt;
        const maxSpeed = target ? 88 : 48;
        const speed = Math.max(1, Math.hypot(fish.vx, fish.vy));
        if (speed > maxSpeed) { fish.vx = fish.vx / speed * maxSpeed; fish.vy = fish.vy / speed * maxSpeed; }
        fish.x += fish.vx * dt;
        fish.y += fish.vy * dt;
        const node = fishNodes.current[index];
        if (node) {
          const direction = fish.vx < 0 ? -1 : 1;
          const angle = Math.atan2(fish.vy, Math.max(18, Math.abs(fish.vx))) * 180 / Math.PI;
          node.dataset.behaviour = behaviour;
          node.style.transform = `translate3d(${fish.x}px, ${fish.y}px, 0) rotate(${angle * direction}deg) scale(${FISH[index].scale}) scaleX(${direction})`;
        }
      });
      if (eaten.size) replaceFood((items) => items.filter((item) => !eaten.has(item.id)));
      frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("blur", clearPointer); };
  }, []);
  return <div ref={pondRef} className="pixel-fish-pond" aria-label="Pixel fish pond" onPointerMove={(event) => { pointer.current = pondPoint(event); }} onPointerLeave={() => { pointer.current = null; }} onPointerCancel={() => { pointer.current = null; }} onPointerDown={dropFood}>{FISH.map(({ species }, index) => (
    <span ref={(node) => { fishNodes.current[index] = node; }} className="pixel-fish-lane" data-fish-index={index} data-behaviour="wandering" key={`${species}-${index}`}><FishSprite species={species} /></span>
  ))}{food.map((item) => <span className="pixel-fish-food" key={item.id} style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%` }}>{Array.from({ length: 7 }, (_, index) => <i key={index} style={{ "--food-x": `${(index % 3 - 1) * 7}px`, "--food-delay": `${index * 70}ms` } as CSSProperties} />)}</span>)}<i className="pond-lily lily-one" /><i className="pond-lily lily-two" /></div>;
}

function FishSprite({ species }: { species: string }) {
  const common = <><rect className="fish-eye" x="62" y="15" width="4" height="4" /><rect className="fish-highlight" x="49" y="12" width="7" height="3" /></>;
  if (species === "Orange roughy") return <svg className="pixel-fish fish-orange-roughy" viewBox="0 0 80 40" role="img" aria-label={species} shapeRendering="crispEdges"><path d="M4 8h9v5h6V8h8V5h28v4h9v5h7v12h-7v5h-9v4H27v-3h-8v-5h-6v6H4v-9H0V15h4z" /><path className="fish-fin" d="M27 5h8V0h7v5h8v4H27zm2 30h24v5H37v-3h-8z" />{common}</svg>;
  if (species === "Blue cod") return <svg className="pixel-fish fish-blue-cod" viewBox="0 0 90 34" role="img" aria-label={species} shapeRendering="crispEdges"><path d="M2 8h12v4h8V7h38v3h13v4h10v8H73v4H60v3H22v-4h-8v5H2v-8H0v-8h2z" /><path className="fish-mark" d="M29 10h8v5h-8zm15 8h9v5h-9zm14-7h7v4h-7z" />{common}</svg>;
  if (species === "Snapper") return <svg className="pixel-fish fish-snapper" viewBox="0 0 86 38" role="img" aria-label={species} shapeRendering="crispEdges"><path d="M3 7h11v6h8V9h31v3h13v4h12v8H66v5H53v4H22v-5h-8v6H3v-9H0v-9h3z" /><path className="fish-belly" d="M27 22h34v7H49v4H28z" /><path className="fish-fin" d="M30 9h9V3h18v7z" />{common}</svg>;
  if (species === "Sea perch") return <svg className="pixel-fish fish-sea-perch" viewBox="0 0 80 40" role="img" aria-label={species} shapeRendering="crispEdges"><path d="M4 8h10v5h7V8h31v3h12v4h9v11h-9v4H52v5H21v-4h-7v5H4v-9H0V15h4z" /><path className="fish-stripe" d="M28 9h5v23h-5zm12-1h5v26h-5zm12 4h5v18h-5z" /><path className="fish-fin" d="M25 8h5V2h5v5h5V1h5v7h7v4H25z" />{common}</svg>;
  return <svg className="pixel-fish fish-gemfish" viewBox="0 0 104 30" role="img" aria-label={species} shapeRendering="crispEdges"><path d="M2 8h17v3h12V7h45v3h13v4h10v5H89v4H76v3H31v-3H19v3H2v-6H0v-7h2z" /><path className="fish-back" d="M31 7h45v5H31z" /><path className="fish-fin" d="M38 7h9V2h18v5z" />{common}</svg>;
}

type SkyStar = { id: string; name: string; ra: number; dec: number; magnitude: number };
type Constellation = { name: string; description: string; stars: SkyStar[]; lines: [string, string][] };

const CONSTELLATIONS: Constellation[] = [
  { name: "Orion", description: "The Hunter is one of the most recognisable constellations. Its three aligned belt stars sit between red Betelgeuse and blue-white Rigel.", stars: [
    { id: "betelgeuse", name: "Betelgeuse", ra: 5.9195, dec: 7.407, magnitude: .42 }, { id: "bellatrix", name: "Bellatrix", ra: 5.4189, dec: 6.349, magnitude: 1.64 }, { id: "mintaka", name: "Mintaka", ra: 5.5334, dec: -.299, magnitude: 2.23 }, { id: "alnilam", name: "Alnilam", ra: 5.6036, dec: -1.202, magnitude: 1.69 }, { id: "alnitak", name: "Alnitak", ra: 5.6793, dec: -1.943, magnitude: 1.77 }, { id: "rigel", name: "Rigel", ra: 5.2423, dec: -8.202, magnitude: .13 }, { id: "saiph", name: "Saiph", ra: 5.7959, dec: -9.67, magnitude: 2.06 },
  ], lines: [["betelgeuse","bellatrix"],["betelgeuse","alnitak"],["bellatrix","mintaka"],["mintaka","alnilam"],["alnilam","alnitak"],["alnitak","saiph"],["mintaka","rigel"],["rigel","saiph"]] },
  { name: "Crux", description: "The Southern Cross is a compact southern constellation used for navigation. Its long axis points roughly toward the south celestial pole.", stars: [
    { id: "acrux", name: "Acrux", ra: 12.4433, dec: -63.099, magnitude: .76 }, { id: "mimosa", name: "Mimosa", ra: 12.7953, dec: -59.688, magnitude: 1.25 }, { id: "gacrux", name: "Gacrux", ra: 12.5194, dec: -57.113, magnitude: 1.63 }, { id: "imai", name: "Imai", ra: 12.2524, dec: -58.749, magnitude: 2.79 },
  ], lines: [["gacrux","acrux"],["mimosa","imai"]] },
  { name: "Scorpius", description: "Scorpius traces a hooked scorpion across the Milky Way. Orange Antares marks its heart and Shaula sits near the stinger.", stars: [
    { id: "antares", name: "Antares", ra: 16.4901, dec: -26.432, magnitude: .96 }, { id: "dschubba", name: "Dschubba", ra: 16.0056, dec: -22.622, magnitude: 2.32 }, { id: "acrab", name: "Acrab", ra: 16.0906, dec: -19.806, magnitude: 2.62 }, { id: "sargas", name: "Sargas", ra: 17.6219, dec: -42.997, magnitude: 1.86 }, { id: "shaula", name: "Shaula", ra: 17.5601, dec: -37.103, magnitude: 1.62 },
  ], lines: [["acrab","dschubba"],["dschubba","antares"],["antares","shaula"],["shaula","sargas"]] },
  { name: "Ursa Major", description: "Ursa Major, the Great Bear, contains the Big Dipper. The outer bowl stars Dubhe and Merak point toward Polaris.", stars: [
    { id: "dubhe", name: "Dubhe", ra: 11.0621, dec: 61.751, magnitude: 1.79 }, { id: "merak", name: "Merak", ra: 11.0307, dec: 56.382, magnitude: 2.37 }, { id: "phecda", name: "Phecda", ra: 11.8972, dec: 53.695, magnitude: 2.44 }, { id: "megrez", name: "Megrez", ra: 12.257, dec: 57.033, magnitude: 3.31 }, { id: "alioth", name: "Alioth", ra: 12.9005, dec: 55.959, magnitude: 1.77 }, { id: "mizar", name: "Mizar", ra: 13.3987, dec: 54.925, magnitude: 2.23 }, { id: "alkaid", name: "Alkaid", ra: 13.7923, dec: 49.313, magnitude: 1.86 },
  ], lines: [["dubhe","merak"],["merak","phecda"],["phecda","megrez"],["megrez","dubhe"],["megrez","alioth"],["alioth","mizar"],["mizar","alkaid"]] },
  { name: "Cassiopeia", description: "Cassiopeia is the prominent W-shaped queen of the northern sky. It lies opposite the Big Dipper across Polaris.", stars: [
    { id: "caph", name: "Caph", ra: .1529, dec: 59.15, magnitude: 2.28 }, { id: "schedar", name: "Schedar", ra: .6751, dec: 56.537, magnitude: 2.24 }, { id: "navi", name: "Navi", ra: .9451, dec: 60.717, magnitude: 2.15 }, { id: "ruchbah", name: "Ruchbah", ra: 1.4303, dec: 60.235, magnitude: 2.68 }, { id: "segin", name: "Segin", ra: 1.9066, dec: 63.67, magnitude: 3.35 },
  ], lines: [["caph","schedar"],["schedar","navi"],["navi","ruchbah"],["ruchbah","segin"]] },
  { name: "Leo", description: "Leo represents the lion. Regulus marks its heart, while a curved sickle of stars outlines its head and mane.", stars: [
    { id: "regulus", name: "Regulus", ra: 10.1395, dec: 11.967, magnitude: 1.35 }, { id: "algieba", name: "Algieba", ra: 10.3329, dec: 19.842, magnitude: 2.01 }, { id: "zosma", name: "Zosma", ra: 11.2351, dec: 20.524, magnitude: 2.56 }, { id: "denebola", name: "Denebola", ra: 11.8177, dec: 14.572, magnitude: 2.14 },
  ], lines: [["regulus","algieba"],["algieba","zosma"],["zosma","denebola"],["denebola","regulus"]] },
];

function StarField({ location }: { location?: IdleLocation }) {
  const latitude = location?.latitude ?? -37.8136;
  const longitude = location?.longitude ?? 144.9631;
  const [now, setNow] = useState(() => new Date());
  const [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(timer); }, []);
  const projected = useMemo(() => CONSTELLATIONS.map((constellation) => {
    const stars = constellation.stars.map((star) => ({ ...star, ...projectStar(star, latitude, longitude, now) })).filter((star) => star.altitude > -4);
    return { ...constellation, stars, byId: new Map(stars.map((star) => [star.id, star])) };
  }), [latitude, longitude, now]);
  const backgroundStars = useMemo(() => Array.from({ length: 260 }, (_, index) => ({ x: (Math.sin(index * 91.17) * 43758.5453 % 1 + 1) % 1 * 100, y: (Math.sin(index * 47.73 + 2.4) * 24634.6345 % 1 + 1) % 1 * 100, size: .7 + index % 5 * .28 })), []);
  const active = projected.find((constellation) => constellation.name === hovered);
  const activePosition = active?.stars.length ? { x: active.stars.reduce((sum, star) => sum + star.x, 0) / active.stars.length, y: active.stars.reduce((sum, star) => sum + star.y, 0) / active.stars.length } : null;
  return <div className="night-sky" aria-label={`Night sky above ${location?.name || "Melbourne"}`}>
    <div className="milky-way" aria-hidden="true" />
    {backgroundStars.map((star, index) => <i className="background-star" key={index} style={{ left: `${star.x}%`, top: `${star.y}%`, width: star.size, height: star.size, animationDelay: `${-(index % 29) * .19}s` }} />)}
    <svg className="constellation-map" viewBox="0 0 100 100" preserveAspectRatio="none">
      <circle className="sky-horizon" cx="50" cy="50" r="48" />
      {projected.map((constellation) => <g key={constellation.name} className={`constellation ${hovered === constellation.name ? "highlighted" : ""}`} onPointerEnter={() => setHovered(constellation.name)} onPointerLeave={() => setHovered(null)}>
        {constellation.lines.map(([fromId, toId]) => { const from = constellation.byId.get(fromId); const to = constellation.byId.get(toId); if (!from || !to) return null; return <g key={`${fromId}-${toId}`}><line className="constellation-hit-line" x1={from.x} y1={from.y} x2={to.x} y2={to.y} /><line className="constellation-line" x1={from.x} y1={from.y} x2={to.x} y2={to.y} /></g>; })}
        {constellation.stars.map((star) => <circle className="constellation-hit-star" key={`hit-${star.id}`} cx={star.x} cy={star.y} r="2.2" />)}
      </g>)}
    </svg>
    {projected.flatMap((constellation) => constellation.stars.map((star) => <i key={`${constellation.name}-${star.id}`} className={`constellation-star-dot ${hovered === constellation.name ? "highlighted" : ""}`} title={`${star.name} · ${constellation.name}`} style={{ left: `${star.x}%`, top: `${star.y}%`, width: `${Math.max(2.2, 5.8 - star.magnitude)}px`, height: `${Math.max(2.2, 5.8 - star.magnitude)}px` }} />))}
    {active && activePosition ? <aside className="constellation-popup" style={{ left: `${Math.min(80, Math.max(20, activePosition.x))}%`, top: `${Math.min(72, Math.max(22, activePosition.y))}%` }}><strong>{active.name}</strong><span>{active.description}</span></aside> : null}
  </div>;
}

function projectStar(star: SkyStar, latitude: number, longitude: number, date: Date) {
  const julianDate = date.getTime() / 86_400_000 + 2_440_587.5;
  const days = julianDate - 2_451_545;
  const localSiderealHours = ((18.697374558 + 24.06570982441908 * days + longitude / 15) % 24 + 24) % 24;
  const hourAngle = ((localSiderealHours - star.ra) * 15 * Math.PI) / 180;
  const lat = latitude * Math.PI / 180;
  const dec = star.dec * Math.PI / 180;
  const altitude = Math.asin(Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(hourAngle));
  const azimuth = Math.atan2(-Math.sin(hourAngle) * Math.cos(dec), Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(hourAngle));
  const altitudeDegrees = altitude * 180 / Math.PI;
  const radius = Math.min(1.08, (90 - altitudeDegrees) / 94) * 47;
  return { altitude: altitudeDegrees, x: 50 + Math.sin(azimuth) * radius, y: 50 - Math.cos(azimuth) * radius };
}

function TopographicBackground({ location }: { location?: IdleLocation }) {
  const origin = location || { name: "Melbourne", latitude: -37.8136, longitude: 144.9631 };
  const [center, setCenter] = useState({ latitude: origin.latitude, longitude: origin.longitude });
  const [zoom, setZoom] = useState(12);
  const manualUntil = useRef(0);
  const viewRef = useRef(center);
  const tourRef = useRef({ index: 0, started: 0, from: center });
  const fallbackWaypoints = useMemo(() => [
    { latitude: origin.latitude, longitude: origin.longitude, feature: "selected location" },
    { latitude: origin.latitude + .014, longitude: origin.longitude - .018, feature: "nearby ridge" },
    { latitude: origin.latitude + .026, longitude: origin.longitude + .006, feature: "creek valley" },
    { latitude: origin.latitude + .008, longitude: origin.longitude + .027, feature: "trail country" },
    { latitude: origin.latitude - .019, longitude: origin.longitude + .018, feature: "landmark approach" },
    { latitude: origin.latitude - .027, longitude: origin.longitude - .009, feature: "lower watershed" },
    { latitude: origin.latitude - .006, longitude: origin.longitude - .026, feature: "hiking terrain" },
  ], [origin.latitude, origin.longitude]);
  const [waypoints, setWaypoints] = useState(fallbackWaypoints);
  useEffect(() => {
    const next = { latitude: origin.latitude, longitude: origin.longitude };
    viewRef.current = next;
    tourRef.current = { index: 0, started: 0, from: next };
    setCenter(next);
    setWaypoints(fallbackWaypoints);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 11_000);
    loadTerrainWaypoints(origin, controller.signal).then((features) => { if (features.length >= 2) setWaypoints([{ ...next, feature: "selected location" }, ...features]); }).catch(() => undefined).finally(() => window.clearTimeout(timeout));
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [fallbackWaypoints, origin.latitude, origin.longitude]);
  useEffect(() => {
    let frame = 0;
    let lastPaint = 0;
    const animate = (now: number) => {
      if (now - lastPaint < 50) { frame = window.requestAnimationFrame(animate); return; }
      lastPaint = now;
      if (Date.now() < manualUntil.current) { tourRef.current.started = 0; frame = window.requestAnimationFrame(animate); return; }
      const tour = tourRef.current;
      if (!tour.started) { tour.started = now; tour.from = viewRef.current; }
      if (now < tour.started) { frame = window.requestAnimationFrame(animate); return; }
      const target = waypoints[(tour.index + 1) % waypoints.length];
      const progress = Math.min(1, (now - tour.started) / 32_000);
      const eased = progress * progress * (3 - 2 * progress);
      const next = { latitude: tour.from.latitude + (target.latitude - tour.from.latitude) * eased, longitude: tour.from.longitude + (target.longitude - tour.from.longitude) * eased };
      viewRef.current = next;
      setCenter(next);
      if (progress >= 1) { tour.index = (tour.index + 1) % waypoints.length; tour.started = now + 5_000; tour.from = target; }
      frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [waypoints]);
  const pauseAmbient = () => { manualUntil.current = Date.now() + 20_000; };
  return <div className="idle-topographic-map" data-tour-feature={waypoints[(tourRef.current.index + 1) % waypoints.length].feature}><InteractiveMap center={center} zoom={zoom} onInteractionStart={pauseAmbient} onViewChange={(nextCenter, nextZoom) => { pauseAmbient(); viewRef.current = nextCenter; setCenter(nextCenter); setZoom(nextZoom); }} interactive showControls showAttribution={false} baseTileUrl={(tileZoom, x, y) => `https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/${tileZoom}/${y}/${x}`} /></div>;
}

type TerrainFeature = { latitude: number; longitude: number; feature: string };
type OverpassFeature = { lat?: number; lon?: number; center?: { lat?: number; lon?: number }; tags?: Record<string, string> };

async function loadTerrainWaypoints(origin: IdleLocation, signal: AbortSignal): Promise<TerrainFeature[]> {
  const around = `around:12000,${origin.latitude.toFixed(6)},${origin.longitude.toFixed(6)}`;
  const query = `[out:json][timeout:9];node(${around})["natural"~"peak|saddle|waterfall"]["name"]->.landmarks;.landmarks out body 5;way(${around})["waterway"~"stream|river"]["name"]->.creeks;.creeks out tags center 5;relation(${around})["route"="hiking"]["name"]->.hikes;.hikes out tags center 5;way(${around})["highway"~"path|track"]["name"]->.paths;.paths out tags center 5;`;
  const response = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" }, body: `data=${encodeURIComponent(query)}`, signal });
  if (!response.ok) throw new Error(`Terrain feature lookup returned ${response.status}`);
  const data = await response.json() as { elements?: OverpassFeature[] };
  const buckets = new Map<string, TerrainFeature[]>();
  for (const element of data.elements || []) {
    const latitude = element.lat ?? element.center?.lat;
    const longitude = element.lon ?? element.center?.lon;
    const tags = element.tags || {};
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !tags.name) continue;
    const category = tags.waterway ? "creek" : tags.route === "hiking" ? "hiking trail" : tags.highway === "path" || tags.highway === "track" ? "walking trail" : "landmark";
    const point = { latitude: latitude as number, longitude: longitude as number, feature: `${category}: ${tags.name}` };
    const existing = buckets.get(category) || [];
    if (existing.length < 3 && !existing.some((candidate) => Math.hypot(candidate.latitude - point.latitude, candidate.longitude - point.longitude) < .003)) buckets.set(category, [...existing, point]);
  }
  return ["landmark", "hiking trail", "walking trail", "creek"].flatMap((category) => buckets.get(category) || []).slice(0, 8);
}

function SlideshowBackground({ folder, fit }: { folder?: string; fit: SlideshowFit }) {
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
  return <div className={`idle-slideshow slideshow-fit-${fit}`}>{dataUrl && fit === "contain" ? <img className="idle-slideshow-backdrop" src={dataUrl} alt="" aria-hidden="true" /> : null}{dataUrl ? <img className="idle-slideshow-image" src={dataUrl} alt="Album slideshow" /> : null}</div>;
}
