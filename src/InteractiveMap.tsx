import { Plane } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { adsbAltitudeColor, clampMapZoom, MAP_MAX_ZOOM, MAP_MIN_ZOOM, overzoomTile, projectMapPosition, unprojectMapPosition, zoomMapAroundPoint } from "./mapTiles";

export type MapPoint = {
  id: string;
  latitude: number;
  longitude: number;
  heading?: number;
  altitude?: number | null;
  onGround?: boolean;
  label?: string;
  title?: string;
};

export type MapTrailPoint = {
  latitude: number;
  longitude: number;
  altitude: number | null;
  onGround?: boolean;
};

export type MapTrail = { id: string; points: MapTrailPoint[] };

type MapCenter = { latitude: number; longitude: number };
type DragGesture = {
  pointerId: number;
  x: number;
  y: number;
  center: MapCenter;
  zoom: number;
};

const TILE_SIZE = 256;

export function InteractiveMap({
  center,
  zoom,
  points = [],
  trails = [],
  selectedPointId,
  radarTileUrl,
  radarMaxZoom = MAP_MAX_ZOOM,
  monochrome = false,
  className = "",
  baseTileUrl = (tileZoom, x, y) => `https://tile.openstreetmap.org/${tileZoom}/${x}/${y}.png`,
  attribution = "© OpenStreetMap contributors",
  showControls = true,
  showAttribution = true,
  interactive = true,
  onViewChange,
  onSelectPoint,
  onMonochromeChange,
  onInteractionStart,
}: {
  center: MapCenter;
  zoom: number;
  points?: MapPoint[];
  trails?: MapTrail[];
  selectedPointId?: string | null;
  radarTileUrl?: (zoom: number, x: number, y: number) => string;
  radarMaxZoom?: number;
  monochrome?: boolean;
  className?: string;
  baseTileUrl?: (zoom: number, x: number, y: number) => string;
  attribution?: string;
  showControls?: boolean;
  showAttribution?: boolean;
  interactive?: boolean;
  onViewChange: (center: MapCenter, zoom: number) => void;
  onSelectPoint?: (id: string) => void;
  onMonochromeChange?: (value: boolean) => void;
  onInteractionStart?: () => void;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchOrigin = useRef<{ distance: number; zoom: number } | null>(null);
  const dragGesture = useRef<DragGesture | null>(null);
  const panOffsetRef = useRef({ x: 0, y: 0 });
  const [size, setSize] = useState({ width: 600, height: 300 });
  const [panOffset, setPanOffsetState] = useState({ x: 0, y: 0 });
  const safeZoom = clampMapZoom(zoom);
  const viewRef = useRef({ center, zoom: safeZoom });
  const worldSize = TILE_SIZE * 2 ** safeZoom;
  const centerWorld = projectMapPosition(center.latitude, center.longitude, safeZoom);

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

  const trailSegments = useMemo(() => trails.flatMap((trail) => trail.points.slice(1).flatMap((point, index) => {
    const previous = trail.points[index];
    const start = mapScreenPoint(previous, centerWorld, worldSize, size, panOffset);
    const end = mapScreenPoint(point, centerWorld, worldSize, size, panOffset);
    const outside = Math.max(start.x, end.x) < -40 || Math.min(start.x, end.x) > size.width + 40 || Math.max(start.y, end.y) < -40 || Math.min(start.y, end.y) > size.height + 40;
    if (outside || Math.abs(start.x - end.x) > size.width) return [];
    return [{ key: `${trail.id}-${index}`, start, end, colour: adsbAltitudeColor(point.altitude, point.onGround) }];
  })), [centerWorld.x, centerWorld.y, panOffset, safeZoom, size, trails, worldSize]);

  function updatePointer(event: React.PointerEvent<HTMLDivElement>) {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  function setPanOffset(x: number, y: number) {
    const next = { x, y };
    panOffsetRef.current = next;
    setPanOffsetState(next);
  }

  function changeView(nextCenter: MapCenter, nextZoom: number) {
    const clampedZoom = clampMapZoom(nextZoom);
    viewRef.current = { center: nextCenter, zoom: clampedZoom };
    onViewChange(nextCenter, clampedZoom);
  }

  function pointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!interactive) return;
    onInteractionStart?.();
    event.currentTarget.setPointerCapture(event.pointerId);
    updatePointer(event);
    if (pointers.current.size === 1) {
      dragGesture.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        center: viewRef.current.center,
        zoom: viewRef.current.zoom,
      };
      setPanOffset(0, 0);
    }
    if (pointers.current.size === 2) {
      commitPan();
      const [a, b] = Array.from(pointers.current.values());
      pinchOrigin.current = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom: viewRef.current.zoom };
    }
  }

  function pointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!interactive) return;
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
      const gesture = dragGesture.current;
      if (!element || !gesture || gesture.pointerId !== event.pointerId) return;
      const bounds = element.getBoundingClientRect();
      const scaleX = bounds.width / Math.max(1, element.clientWidth);
      const scaleY = bounds.height / Math.max(1, element.clientHeight);
      const deltaX = (event.clientX - gesture.x) / Math.max(0.01, scaleX);
      const deltaY = (event.clientY - gesture.y) / Math.max(0.01, scaleY);
      const discontinuityLimit = Math.max(element.clientWidth, element.clientHeight) * 3;
      if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || Math.abs(deltaX) > discontinuityLimit || Math.abs(deltaY) > discontinuityLimit) {
        dragGesture.current = { ...gesture, x: event.clientX, y: event.clientY, center: viewRef.current.center };
        setPanOffset(0, 0);
        return;
      }
      setPanOffset(deltaX, deltaY);
    }
  }

  function pointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!interactive) return;
    if (!pointers.current.has(event.pointerId)) return;
    if (pointers.current.size === 1 && dragGesture.current?.pointerId === event.pointerId) commitPan();
    pointers.current.delete(event.pointerId);
    pinchOrigin.current = null;
    if (pointers.current.size === 1) {
      const [pointerId, point] = Array.from(pointers.current.entries())[0];
      dragGesture.current = { pointerId, ...point, center: viewRef.current.center, zoom: viewRef.current.zoom };
    } else if (pointers.current.size === 0) {
      dragGesture.current = null;
      setPanOffset(0, 0);
    }
  }

  function commitPan() {
    const gesture = dragGesture.current;
    const offset = panOffsetRef.current;
    if (!gesture || (!offset.x && !offset.y)) {
      dragGesture.current = null;
      setPanOffset(0, 0);
      return;
    }
    const originWorld = projectMapPosition(gesture.center.latitude, gesture.center.longitude, gesture.zoom);
    const nextCenter = unprojectMapPosition(originWorld.x - offset.x, originWorld.y - offset.y, gesture.zoom);
    dragGesture.current = null;
    setPanOffset(0, 0);
    changeView(nextCenter, gesture.zoom);
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
      onLostPointerCapture={pointerUp}
      onWheel={(event) => {
        if (!interactive) return;
        onInteractionStart?.();
        event.preventDefault();
        const element = event.currentTarget;
        const bounds = element.getBoundingClientRect();
        const scaleX = bounds.width / Math.max(1, element.clientWidth);
        const scaleY = bounds.height / Math.max(1, element.clientHeight);
        const currentView = viewRef.current;
        const nextZoom = clampMapZoom(currentView.zoom + (event.deltaY < 0 ? 1 : -1));
        if (nextZoom === currentView.zoom) return;
        const offsetX = (event.clientX - bounds.left) / Math.max(0.01, scaleX) - element.clientWidth / 2;
        const offsetY = (event.clientY - bounds.top) / Math.max(0.01, scaleY) - element.clientHeight / 2;
        changeView(zoomMapAroundPoint(currentView.center, currentView.zoom, nextZoom, offsetX, offsetY), nextZoom);
      }}
    >
      <div className="map-tiles" aria-hidden="true" style={{ transform: `translate3d(${panOffset.x}px, ${panOffset.y}px, 0)` }}>
        {tiles.map((tile) => (
          <div className="map-tile-stack" key={tile.key} style={{ left: tile.left, top: tile.top }}>
            <img className="map-base-tile" src={baseTileUrl(safeZoom, tile.wrappedX, tile.y)} draggable={false} alt="" />
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
      {trailSegments.length ? (
        <svg className="map-trails" viewBox={`0 0 ${size.width} ${size.height}`} aria-label="Selected aircraft altitude trail">
          {trailSegments.map((segment) => (
            <g key={segment.key}>
              <line className="map-trail-outline" x1={segment.start.x} y1={segment.start.y} x2={segment.end.x} y2={segment.end.y} />
              <line className="map-trail-segment" x1={segment.start.x} y1={segment.start.y} x2={segment.end.x} y2={segment.end.y} stroke={segment.colour} />
            </g>
          ))}
        </svg>
      ) : null}
      {points.map((point) => {
        const screenPoint = mapScreenPoint(point, centerWorld, worldSize, size, panOffset);
        const { x: left, y: top } = screenPoint;
        if (left < -30 || left > size.width + 30 || top < -30 || top > size.height + 30) return null;
        return (
          <button
            className={`map-aircraft ${selectedPointId === point.id ? "selected" : ""}`}
            key={point.id}
            title={point.title || point.label}
            data-altitude-colour={adsbAltitudeColor(point.altitude, point.onGround)}
            style={{ left, top, backgroundColor: adsbAltitudeColor(point.altitude, point.onGround) }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onSelectPoint?.(point.id)}
          >
            <Plane size={selectedPointId === point.id ? 25 : 19} style={{ transform: `rotate(${(point.heading || 0) - 45}deg)` }} />
            {point.label ? <span>{point.label}</span> : null}
          </button>
        );
      })}
      {showControls ? <div className="map-controls" onPointerDown={(event) => event.stopPropagation()}>
        <button onClick={() => changeView(viewRef.current.center, Math.min(MAP_MAX_ZOOM, safeZoom + 1))} disabled={safeZoom >= MAP_MAX_ZOOM} title="Zoom in">+</button>
        <button onClick={() => changeView(viewRef.current.center, Math.max(MAP_MIN_ZOOM, safeZoom - 1))} disabled={safeZoom <= MAP_MIN_ZOOM} title="Zoom out">−</button>
        {onMonochromeChange ? (
          <button
            className="map-theme-button"
            onClick={() => onMonochromeChange(!monochrome)}
            title={monochrome ? "Use colour map" : "Use monochrome map"}
          >◐</button>
        ) : null}
      </div> : null}
      {showAttribution ? <span className="map-attribution">{attribution}</span> : null}
    </div>
  );
}

function mapScreenPoint(point: { latitude: number; longitude: number }, centerWorld: { x: number; y: number }, worldSize: number, size: { width: number; height: number }, panOffset: { x: number; y: number }) {
  const zoom = Math.log2(worldSize / TILE_SIZE);
  const projected = projectMapPosition(point.latitude, point.longitude, zoom);
  let deltaX = projected.x - centerWorld.x;
  if (deltaX > worldSize / 2) deltaX -= worldSize;
  if (deltaX < -worldSize / 2) deltaX += worldSize;
  return {
    x: size.width / 2 + deltaX + panOffset.x,
    y: size.height / 2 + projected.y - centerWorld.y + panOffset.y,
  };
}
