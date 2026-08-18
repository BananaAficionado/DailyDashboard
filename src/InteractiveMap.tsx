import { Plane } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { clampMapZoom, MAP_MAX_ZOOM, MAP_MIN_ZOOM, overzoomTile } from "./mapTiles";

export type MapPoint = {
  id: string;
  latitude: number;
  longitude: number;
  heading?: number;
  label?: string;
  title?: string;
};

type MapCenter = { latitude: number; longitude: number };

const TILE_SIZE = 256;

export function InteractiveMap({
  center,
  zoom,
  points = [],
  selectedPointId,
  radarTileUrl,
  radarMaxZoom = MAP_MAX_ZOOM,
  monochrome = false,
  className = "",
  onViewChange,
  onSelectPoint,
  onMonochromeChange,
}: {
  center: MapCenter;
  zoom: number;
  points?: MapPoint[];
  selectedPointId?: string | null;
  radarTileUrl?: (zoom: number, x: number, y: number) => string;
  radarMaxZoom?: number;
  monochrome?: boolean;
  className?: string;
  onViewChange: (center: MapCenter, zoom: number) => void;
  onSelectPoint?: (id: string) => void;
  onMonochromeChange?: (value: boolean) => void;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchOrigin = useRef<{ distance: number; zoom: number } | null>(null);
  const [size, setSize] = useState({ width: 600, height: 300 });
  const safeZoom = clampMapZoom(zoom);
  const viewRef = useRef({ center, zoom: safeZoom });
  const worldSize = TILE_SIZE * 2 ** safeZoom;
  const centerWorld = project(center.latitude, center.longitude, safeZoom);

  useEffect(() => {
    viewRef.current = { center, zoom: safeZoom };
  }, [center.latitude, center.longitude, safeZoom]);

  useEffect(() => {
    const element = mapRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const tiles = useMemo(() => {
    const tileX = Math.floor(centerWorld.x / TILE_SIZE);
    const tileY = Math.floor(centerWorld.y / TILE_SIZE);
    const xRadius = Math.ceil(size.width / TILE_SIZE / 2) + 1;
    const yRadius = Math.ceil(size.height / TILE_SIZE / 2) + 1;
    const count = 2 ** safeZoom;
    const result: { key: string; x: number; y: number; wrappedX: number; left: number; top: number }[] = [];
    for (let y = tileY - yRadius; y <= tileY + yRadius; y += 1) {
      if (y < 0 || y >= count) continue;
      for (let x = tileX - xRadius; x <= tileX + xRadius; x += 1) {
        const wrappedX = ((x % count) + count) % count;
        result.push({
          key: `${safeZoom}-${x}-${y}`,
          x: wrappedX,
          wrappedX,
          y,
          left: x * TILE_SIZE - centerWorld.x + size.width / 2,
          top: y * TILE_SIZE - centerWorld.y + size.height / 2,
        });
      }
    }
    return result;
  }, [centerWorld.x, centerWorld.y, safeZoom, size.height, size.width]);

  function updatePointer(event: React.PointerEvent<HTMLDivElement>) {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  function changeView(nextCenter: MapCenter, nextZoom: number) {
    const clampedZoom = clampMapZoom(nextZoom);
    viewRef.current = { center: nextCenter, zoom: clampedZoom };
    onViewChange(nextCenter, clampedZoom);
  }

  function pointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    updatePointer(event);
    if (pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values());
      pinchOrigin.current = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom: viewRef.current.zoom };
    }
  }

  function pointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    updatePointer(event);
    if (pointers.current.size === 2 && pinchOrigin.current) {
      const [a, b] = Array.from(pointers.current.values());
      const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const nextZoom = clampMapZoom(pinchOrigin.current.zoom + Math.log2(distance / pinchOrigin.current.distance));
      changeView(viewRef.current.center, nextZoom);
      return;
    }
    if (pointers.current.size === 1) {
      const element = mapRef.current;
      if (!element) return;
      const bounds = element.getBoundingClientRect();
      const scaleX = bounds.width / Math.max(1, element.clientWidth);
      const scaleY = bounds.height / Math.max(1, element.clientHeight);
      const currentView = viewRef.current;
      const originWorld = project(currentView.center.latitude, currentView.center.longitude, currentView.zoom);
      const nextCenter = unproject(
        originWorld.x - (event.clientX - previous.x) / Math.max(0.01, scaleX),
        originWorld.y - (event.clientY - previous.y) / Math.max(0.01, scaleY),
        currentView.zoom,
      );
      changeView(nextCenter, currentView.zoom);
    }
  }

  function pointerUp(event: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    pinchOrigin.current = null;
  }

  return (
    <div
      ref={mapRef}
      className={`interactive-map ${monochrome ? "map-monochrome" : "map-colour"} ${className}`}
      data-center-latitude={center.latitude.toFixed(6)}
      data-center-longitude={center.longitude.toFixed(6)}
      data-zoom={safeZoom}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onWheel={(event) => {
        event.preventDefault();
        changeView(viewRef.current.center, safeZoom + (event.deltaY < 0 ? 1 : -1));
      }}
    >
      <div className="map-tiles" aria-hidden="true">
        {tiles.map((tile) => (
          <div className="map-tile-stack" key={tile.key} style={{ left: tile.left, top: tile.top }}>
            <img className="map-base-tile" src={`https://tile.openstreetmap.org/${safeZoom}/${tile.wrappedX}/${tile.y}.png`} draggable={false} alt="" />
            {radarTileUrl ? (() => {
              const source = overzoomTile(safeZoom, tile.wrappedX, tile.y, radarMaxZoom);
              return (
                <span
                  className="radar-tile"
                  style={{
                    backgroundImage: `url(${radarTileUrl(source.zoom, source.x, source.y)})`,
                    backgroundPosition: `${-source.offsetX * TILE_SIZE}px ${-source.offsetY * TILE_SIZE}px`,
                    backgroundSize: `${TILE_SIZE * source.scale}px ${TILE_SIZE * source.scale}px`,
                  }}
                />
              );
            })() : null}
          </div>
        ))}
      </div>
      {points.map((point) => {
        const projected = project(point.latitude, point.longitude, safeZoom);
        let deltaX = projected.x - centerWorld.x;
        if (deltaX > worldSize / 2) deltaX -= worldSize;
        if (deltaX < -worldSize / 2) deltaX += worldSize;
        const left = size.width / 2 + deltaX;
        const top = size.height / 2 + projected.y - centerWorld.y;
        if (left < -30 || left > size.width + 30 || top < -30 || top > size.height + 30) return null;
        return (
          <button
            className={`map-aircraft ${selectedPointId === point.id ? "selected" : ""}`}
            key={point.id}
            title={point.title || point.label}
            style={{ left, top }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onSelectPoint?.(point.id)}
          >
            <Plane size={selectedPointId === point.id ? 25 : 19} style={{ transform: `rotate(${(point.heading || 0) - 45}deg)` }} />
            {point.label ? <span>{point.label}</span> : null}
          </button>
        );
      })}
      <div className="map-controls" onPointerDown={(event) => event.stopPropagation()}>
        <button onClick={() => changeView(viewRef.current.center, Math.min(MAP_MAX_ZOOM, safeZoom + 1))} disabled={safeZoom >= MAP_MAX_ZOOM} title="Zoom in">+</button>
        <button onClick={() => changeView(viewRef.current.center, Math.max(MAP_MIN_ZOOM, safeZoom - 1))} disabled={safeZoom <= MAP_MIN_ZOOM} title="Zoom out">−</button>
        {onMonochromeChange ? (
          <button
            className="map-theme-button"
            onClick={() => onMonochromeChange(!monochrome)}
            title={monochrome ? "Use colour map" : "Use monochrome map"}
          >◐</button>
        ) : null}
      </div>
      <span className="map-attribution">© OpenStreetMap contributors</span>
    </div>
  );
}

function project(latitude: number, longitude: number, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom;
  const lat = Math.max(-85.0511, Math.min(85.0511, latitude));
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

function unproject(x: number, y: number, zoom: number): MapCenter {
  const scale = TILE_SIZE * 2 ** zoom;
  const longitude = ((x / scale) * 360 + 540) % 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  return { latitude: (180 / Math.PI) * Math.atan(Math.sinh(n)), longitude };
}
