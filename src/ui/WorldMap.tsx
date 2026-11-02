import { useMemo } from 'react';
import { REGIONS } from '../game/config';
import type { MapData, RegionId } from '../game/types';

interface WorldMapProps {
  map: MapData;
  selected?: RegionId;
  current?: { x: number; z: number; heading: number };
  onSelect?: (region: RegionId) => void;
  compact?: boolean;
}

type Point = [number, number];
type Project = (x: number, z: number) => Point;

const TAU = Math.PI * 2;
const FIELD_COLORS = ['#a9a25e', '#87984f', '#b3a267', '#758b4b', '#9c9858'];
const CITY_COLORS = ['#bab5a1', '#aeb2a2', '#c8b99a', '#9ba296'];

const MOUNTAINS = [
  { x: -500, z: -750, rx: 255, rz: 112, seed: 1.2, snow: true },
  { x: -150, z: -790, rx: 298, rz: 136, seed: 3.4, snow: true },
  { x: 205, z: -755, rx: 218, rz: 108, seed: 5.1, snow: false },
  { x: 520, z: -620, rx: 158, rz: 90, seed: 7.8, snow: false },
  { x: -735, z: -420, rx: 118, rz: 78, seed: 9.1, snow: false },
];

const FORESTS = [
  { x: -360, z: -120, rx: 180, rz: 155, seed: 2.4 },
  { x: -85, z: 235, rx: 215, rz: 155, seed: 4.1 },
  { x: 70, z: -325, rx: 160, rz: 118, seed: 6.3 },
  { x: 645, z: 175, rx: 150, rz: 140, seed: 8.2 },
  { x: -565, z: 255, rx: 118, rz: 128, seed: 10.7 },
];

const FIELD_PATCHES = [
  { x: 448, z: -180, w: 240, h: 142, rotation: -13 },
  { x: 270, z: 20, w: 190, h: 116, rotation: 18 },
  { x: 115, z: 255, w: 160, h: 92, rotation: -8 },
];

const ISLETS = [
  { x: 1110, z: 170, rx: 36, rz: 24, seed: 2.2 },
  { x: -1130, z: -80, rx: 28, rz: 18, seed: 5.7 },
  { x: 760, z: -990, rx: 43, rz: 26, seed: 7.4 },
];

function hash(value: number): number {
  const x = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function organicPoints(cx: number, cz: number, rx: number, rz: number, seed: number): Point[] {
  const points: Point[] = [];
  const steps = 20;
  for (let i = 0; i < steps; i += 1) {
    const angle = (i / steps) * TAU;
    const wobble =
      1 + Math.sin(angle * 3 + seed) * 0.1 + Math.cos(angle * 5 - seed * 1.3) * 0.055;
    points.push([cx + Math.cos(angle) * rx * wobble, cz + Math.sin(angle) * rz * wobble]);
  }
  return points;
}

function makePath(points: Point[], project: Project, close = true): string {
  return (
    points
      .map(([x, z], index) => {
        const [px, py] = project(x, z);
        return `${index === 0 ? 'M' : 'L'} ${px.toFixed(1)} ${py.toFixed(1)}`;
      })
      .join(' ') + (close ? ' Z' : '')
  );
}

export function WorldMap({ map, selected, current, onSelect, compact = false }: WorldMapProps) {
  const uid = compact ? 'mini' : 'full';

  const detail = useMemo(() => {
    const { minX, maxX, minZ, maxZ } = map.bounds;
    const midX = (minX + maxX) / 2;
    const midZ = (minZ + maxZ) / 2;
    const scale = Math.min(1000 / Math.max(1, maxX - minX), 1000 / Math.max(1, maxZ - minZ)) * 0.93;
    const project: Project = (x, z) => [500 + (x - midX) * scale, 500 + (z - midZ) * scale];

    const coastPath = makePath(map.coastline, project);
    const routePath = makePath(map.route, project);
    const junctionPaths = map.junctions.map((road) => ({
      ...road,
      path: makePath(road.points, project, road.id === 'roundabout-ring'),
    }));
    const ringPoints = map.junctions.find((road) => road.id === 'roundabout-ring')?.points ?? [];
    const junctionCenter = ringPoints.length
      ? project(
          ringPoints.reduce((sum, [x]) => sum + x, 0) / ringPoints.length,
          ringPoints.reduce((sum, [, z]) => sum + z, 0) / ringPoints.length,
        )
      : null;

    const mountains = MOUNTAINS.map((mountain) => ({
      base: makePath(organicPoints(mountain.x, mountain.z, mountain.rx, mountain.rz, mountain.seed), project),
      contours: [0.76, 0.53, 0.33].map((shrink) =>
        makePath(
          organicPoints(
            mountain.x,
            mountain.z,
            mountain.rx * shrink,
            mountain.rz * shrink,
            mountain.seed + 1.7,
          ),
          project,
        ),
      ),
      snow: mountain.snow
        ? makePath(
            organicPoints(
              mountain.x - mountain.rx * 0.12,
              mountain.z - mountain.rz * 0.1,
              mountain.rx * 0.28,
              mountain.rz * 0.26,
              mountain.seed + 4.4,
            ),
            project,
          )
        : null,
    }));

    const forests = FORESTS.map((forest) => ({
      path: makePath(organicPoints(forest.x, forest.z, forest.rx, forest.rz, forest.seed), project),
      trees: Array.from({ length: compact ? 0 : 7 }, (_, index) => {
        const angle = hash(forest.seed * 10 + index * 2.3) * TAU;
        const radius = 0.18 + hash(forest.seed * 20 + index * 3.1) * 0.58;
        const [x, y] = project(
          forest.x + Math.cos(angle) * forest.rx * radius,
          forest.z + Math.sin(angle) * forest.rz * radius,
        );
        return { x, y, size: 2.4 + hash(forest.seed + index * 8.7) * 2.1 };
      }),
    }));

    const fields = FIELD_PATCHES.map((patch) => {
      const [cx, cy] = project(patch.x, patch.z);
      const width = patch.w * scale;
      const height = patch.h * scale;
      const cols = 3;
      const rows = 2;
      const gap = Math.max(1.4, scale * 3.5);
      const cellWidth = (width - gap * (cols - 1)) / cols;
      const cellHeight = (height - gap * (rows - 1)) / rows;
      const cells = Array.from({ length: cols * rows }, (_, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        return {
          x: -width / 2 + col * (cellWidth + gap),
          y: -height / 2 + row * (cellHeight + gap),
          width: cellWidth,
          height: cellHeight,
          fill: FIELD_COLORS[Math.floor(hash(index + patch.rotation * 7 + patch.x) * FIELD_COLORS.length)],
        };
      });
      return { cx, cy, width, height, rotation: patch.rotation, cells };
    });

    const cityCenter = project(420, 575);
    const cityWidth = 300 * scale;
    const cityHeight = 178 * scale;
    const cityCols = 6;
    const cityRows = 3;
    const cityGap = Math.max(1.6, scale * 4);
    const blockWidth = (cityWidth - cityGap * (cityCols - 1)) / cityCols;
    const blockHeight = (cityHeight - cityGap * (cityRows - 1)) / cityRows;
    const cityBlocks = Array.from({ length: cityCols * cityRows }, (_, index) => {
      const col = index % cityCols;
      const row = Math.floor(index / cityCols);
      return {
        x: -cityWidth / 2 + col * (blockWidth + cityGap),
        y: -cityHeight / 2 + row * (blockHeight + cityGap),
        width: blockWidth,
        height: blockHeight,
        fill: CITY_COLORS[Math.floor(hash(index * 3.7 + 11) * CITY_COLORS.length)],
      };
    });

    const islets = ISLETS.map((islet) => ({
      path: makePath(organicPoints(islet.x, islet.z, islet.rx, islet.rz, islet.seed), project),
      halo: organicPoints(islet.x, islet.z, islet.rx * 1.35, islet.rz * 1.35, islet.seed + 1.2),
    }));

    return {
      coastPath,
      routePath,
      junctionPaths,
      junctionCenter,
      project,
      scale,
      mountains,
      forests,
      fields,
      city: { cx: cityCenter[0], cy: cityCenter[1], width: cityWidth, height: cityHeight, blocks: cityBlocks },
      islets,
    };
  }, [map, compact]);

  const currentPoint = current ? detail.project(current.x, current.z) : null;

  return (
    <svg
      viewBox="0 0 1000 1000"
      className={`block h-full w-full ${compact ? '' : 'min-h-[300px]'}`}
      role="img"
      aria-label="Halcyon Island map"
    >
      <defs>
        <radialGradient id={`ocean-${uid}`} cx="34%" cy="30%" r="88%">
          <stop offset="0%" stopColor="#24515b" />
          <stop offset="56%" stopColor="#123440" />
          <stop offset="100%" stopColor="#081e28" />
        </radialGradient>
        <linearGradient id={`land-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#85965e" />
          <stop offset="46%" stopColor="#617a50" />
          <stop offset="100%" stopColor="#405b45" />
        </linearGradient>
        <linearGradient id={`peak-${uid}`} x1="0" y1="0" x2="0.8" y2="1">
          <stop offset="0%" stopColor="#66745a" />
          <stop offset="100%" stopColor="#3e5342" />
        </linearGradient>
        <pattern id={`chart-${uid}`} width="104" height="104" patternUnits="userSpaceOnUse">
          <path d="M104 0H0V104" fill="none" stroke="rgba(172,220,219,0.075)" strokeWidth="1" />
        </pattern>
        <filter id={`island-shadow-${uid}`} x="-25%" y="-25%" width="150%" height="150%">
          <feDropShadow dx="0" dy="18" stdDeviation="16" floodColor="#00161c" floodOpacity="0.6" />
        </filter>
        <clipPath id={`island-clip-${uid}`}>
          <path d={detail.coastPath} />
        </clipPath>
      </defs>

      <rect width="1000" height="1000" fill={`url(#ocean-${uid})`} />
      {!compact && <rect width="1000" height="1000" fill={`url(#chart-${uid})`} />}

      {!compact && (
        <g fill="none" stroke="rgba(129,198,197,0.16)">
          <path d={detail.coastPath} strokeWidth="1.2" transform="translate(500 500) scale(1.035) translate(-500 -500)" />
          <path d={detail.coastPath} strokeWidth="1" transform="translate(500 500) scale(1.075) translate(-500 -500)" />
          <path d={detail.coastPath} strokeWidth=".8" transform="translate(500 500) scale(1.13) translate(-500 -500)" strokeDasharray="3 10" />
        </g>
      )}

      {!compact && (
        <g>
          <text x="70" y="103" fill="rgba(182,225,222,0.28)" fontFamily="'IBM Plex Mono', monospace" fontSize="15" letterSpacing="4">
            OPEN SEA
          </text>
          <text x="83" y="130" fill="rgba(182,225,222,0.14)" fontFamily="'IBM Plex Mono', monospace" fontSize="10" letterSpacing="2">
            HALCYON ARCHIPELAGO
          </text>
        </g>
      )}

      {detail.islets.map((islet, index) => (
        <g key={index}>
          <path
            d={islet.path}
            fill="rgba(92,163,158,0.18)"
            stroke="rgba(117,190,185,0.2)"
            strokeWidth={compact ? 5 : 8}
            transform="translate(0 5)"
          />
          <path d={islet.path} fill="#4e6850" stroke="#d5c493" strokeWidth={compact ? 1.5 : 2.2} />
          {!compact && index === 0 && (
            <circle cx={detail.project(1110, 170)[0]} cy={detail.project(1110, 170)[1]} r="2.4" fill="#f0d79d" />
          )}
        </g>
      ))}

      <path
        d={detail.coastPath}
        fill="rgba(4,19,23,0.8)"
        stroke="none"
        filter={compact ? undefined : `url(#island-shadow-${uid})`}
      />
      <path
        d={detail.coastPath}
        fill="none"
        stroke="rgba(96,178,172,0.26)"
        strokeWidth={compact ? 20 : 28}
      />
      <path d={detail.coastPath} fill={`url(#land-${uid})`} stroke="none" />

      <g clipPath={`url(#island-clip-${uid})`}>
        <g opacity={compact ? 0.7 : 0.92}>
          {detail.fields.map((field, index) => (
            <g key={`field-${index}`} transform={`translate(${field.cx} ${field.cy}) rotate(${field.rotation})`}>
              <rect
                x={-field.width / 2 - 2}
                y={-field.height / 2 - 2}
                width={field.width + 4}
                height={field.height + 4}
                fill="rgba(48,67,44,0.36)"
              />
              {field.cells.map((cell, cellIndex) => (
                <rect
                  key={cellIndex}
                  x={cell.x}
                  y={cell.y}
                  width={cell.width}
                  height={cell.height}
                  fill={cell.fill}
                  stroke="rgba(57,77,45,0.45)"
                  strokeWidth={compact ? 0.8 : 0.7}
                />
              ))}
            </g>
          ))}
        </g>

        {detail.forests.map((forest, index) => (
          <g key={`forest-${index}`}>
            <path d={forest.path} fill="#355641" opacity={compact ? 0.55 : 0.68} />
            <path d={forest.path} fill="none" stroke="rgba(193,216,159,0.18)" strokeWidth="1" />
            {forest.trees.map((tree, treeIndex) => (
              <path
                key={treeIndex}
                d="M0 -4 L3 3 H-3 Z"
                transform={`translate(${tree.x} ${tree.y}) scale(${tree.size / 4})`}
                fill="#213f2e"
                opacity="0.72"
              />
            ))}
          </g>
        ))}

        {detail.mountains.map((mountain, index) => (
          <g key={`mountain-${index}`}>
            <path d={mountain.base} fill={`url(#peak-${uid})`} opacity="0.93" />
            {mountain.contours.map((contour, contourIndex) => (
              <path
                key={contourIndex}
                d={contour}
                fill="none"
                stroke="rgba(225,231,207,0.2)"
                strokeWidth={compact ? 0.7 : 1.05}
              />
            ))}
            {!compact && mountain.snow && <path d={mountain.snow ?? undefined} fill="#dfe0cf" opacity="0.86" />}
          </g>
        ))}

        <g transform={`translate(${detail.city.cx} ${detail.city.cy}) rotate(-12)`} opacity="0.96">
          <rect
            x={-detail.city.width / 2 - 5}
            y={-detail.city.height / 2 - 5}
            width={detail.city.width + 10}
            height={detail.city.height + 10}
            fill="rgba(25,46,39,0.7)"
            stroke="rgba(205,204,179,0.22)"
            strokeWidth={compact ? 1 : 1.3}
          />
          {detail.city.blocks.map((block, index) => (
            <g key={index}>
              <rect
                x={block.x}
                y={block.y}
                width={block.width}
                height={block.height}
                fill={block.fill}
                stroke="rgba(51,67,57,0.7)"
                strokeWidth={compact ? 0.8 : 0.9}
              />
              {!compact && hash(index + 8.3) > 0.62 && (
                <rect
                  x={block.x + block.width * 0.2}
                  y={block.y + block.height * 0.22}
                  width={block.width * 0.6}
                  height={block.height * 0.56}
                  fill="rgba(54,70,59,0.46)"
                />
              )}
            </g>
          ))}
        </g>
      </g>

      <path d={detail.coastPath} fill="none" stroke="#ddc892" strokeWidth={compact ? 10 : 8} opacity="0.95" />
      <path d={detail.coastPath} fill="none" stroke="#204238" strokeWidth={compact ? 3 : 2.4} />
      {!compact && (
        <path
          d={detail.coastPath}
          fill="none"
          stroke="rgba(230,249,234,0.55)"
          strokeWidth="1.4"
          strokeDasharray="4 14"
          transform="translate(500 500) scale(1.017) translate(-500 -500)"
        />
      )}

      <path d={detail.routePath} fill="none" stroke="rgba(8,22,22,0.78)" strokeWidth={compact ? 17 : 14} strokeLinejoin="round" />
      <path d={detail.routePath} fill="none" stroke="#f0e1bd" strokeWidth={compact ? 10 : 6.5} strokeLinejoin="round" />
      <path
        d={detail.routePath}
        fill="none"
        stroke="#8f7952"
        strokeWidth={compact ? 2.2 : 1.5}
        strokeDasharray={compact ? '4 8' : '7 10'}
        strokeLinejoin="round"
        opacity="0.85"
      />

      {detail.junctionPaths.map((road) => (
        <g key={road.id}>
          <path
            d={road.path}
            fill="none"
            stroke="rgba(5,18,18,0.86)"
            strokeWidth={compact ? 7 : 8}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path
            d={road.path}
            fill="none"
            stroke={road.kind === 'skyway' ? '#e7cfa4' : '#d7b47b'}
            strokeWidth={compact ? 2.4 : 2.8}
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray={road.kind === 'skyway' ? '7 5' : undefined}
          />
        </g>
      ))}

      {!compact && (
        <g>
          <g transform="translate(897 92)">
            <circle r="32" fill="rgba(5,22,26,0.62)" stroke="rgba(186,230,225,0.22)" />
            <path d="M0 -16 L8 13 L0 8 L-8 13 Z" fill="rgba(240,235,212,0.8)" />
            <text y="51" textAnchor="middle" fill="rgba(220,240,235,0.55)" fontFamily="'IBM Plex Mono', monospace" fontSize="12">
              N
            </text>
          </g>
          <g transform="translate(86 928)">
            <text x="0" y="-10" fill="rgba(182,225,222,0.3)" fontFamily="'IBM Plex Mono', monospace" fontSize="10" letterSpacing="2">
              SCALE
            </text>
            <path
              d={`M0 0 H${(500 * detail.scale).toFixed(1)}`}
              fill="none"
              stroke="rgba(222,234,211,0.55)"
              strokeWidth="2"
            />
            <path
              d={`M0 -5 V5 M${(250 * detail.scale).toFixed(1)} -3 V3 M${(500 * detail.scale).toFixed(1)} -5 V5`}
              fill="none"
              stroke="rgba(222,234,211,0.55)"
              strokeWidth="1.5"
            />
            <text
              x={(500 * detail.scale).toFixed(1)}
              y="20"
              textAnchor="end"
              fill="rgba(182,225,222,0.3)"
              fontFamily="'IBM Plex Mono', monospace"
              fontSize="10"
              letterSpacing="1"
            >
              500 M
            </text>
          </g>
        </g>
      )}

      {map.regions.map((region) => {
        const [x, y] = detail.project(region.x, region.z);
        const definition = REGIONS.find((item) => item.id === region.id);
        const color = definition?.color ?? '#ffb46e';
        const active = selected === region.id;
        const nearLeft = x < 260;
        const nearRight = x > 760;
        const labelAnchor = nearLeft ? 'start' : nearRight ? 'end' : 'middle';
        const labelX = nearLeft ? 26 : nearRight ? -26 : 0;
        return (
          <g
            key={region.id}
            transform={`translate(${x} ${y})`}
            role={onSelect ? 'button' : undefined}
            tabIndex={onSelect ? 0 : undefined}
            aria-label={region.name}
            onClick={() => onSelect?.(region.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onSelect?.(region.id);
            }}
            style={{ cursor: onSelect ? 'pointer' : 'default' }}
          >
            {active && <circle r={compact ? 17 : 30} fill={color} opacity="0.16" />}
            <circle
              r={compact ? 8 : 14}
              fill={active ? color : '#0a1d20'}
              stroke={color}
              strokeWidth={compact ? 2 : 3}
            />
            <circle r={compact ? 2.5 : 4} fill={active ? '#102325' : color} />
            {!compact && (
              <>
                <text
                  x={labelX}
                  y={y > 760 ? -58 : -28}
                  textAnchor={labelAnchor}
                  fill={active ? '#fff8e8' : 'rgba(236,244,234,0.82)'}
                  stroke="rgba(8,23,20,0.7)"
                  strokeWidth="3.5"
                  paintOrder="stroke"
                  fontFamily="'IBM Plex Mono', monospace"
                  fontSize="19"
                  letterSpacing="1.5"
                >
                  {region.name.toUpperCase()}
                </text>
                <text
                  x={labelX}
                  y={y > 760 ? -30 : 38}
                  textAnchor={labelAnchor}
                  fill={active ? color : 'rgba(209,232,218,0.52)'}
                  stroke="rgba(8,23,20,0.55)"
                  strokeWidth="3"
                  paintOrder="stroke"
                  fontFamily="'IBM Plex Mono', monospace"
                  fontSize="13"
                  letterSpacing="1"
                >
                  {definition?.tagline.toUpperCase()}
                </text>
              </>
            )}
          </g>
        );
      })}

      {detail.junctionCenter && (
        <g
          transform={`translate(${detail.junctionCenter[0]} ${detail.junctionCenter[1]})`}
          pointerEvents="none"
        >
          <circle
            r={compact ? 8 : 12}
            fill="rgba(8,23,20,0.82)"
            stroke="#ffb46e"
            strokeWidth="1.6"
          />
          <path
            d="M -4 2 A 4 4 0 1 1 3 -3"
            fill="none"
            stroke="#ffb46e"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <circle cx="3" cy="-3" r="1.5" fill="#fff5dc" />
          {!compact && (
            <>
              <path
                d="M -12 -12 L -26 -27"
                fill="none"
                stroke="rgba(240,225,189,0.55)"
                strokeWidth="1"
              />
              <text
                x="-30"
                y="-30"
                textAnchor="end"
                fill="rgba(245,236,212,0.82)"
                stroke="rgba(8,23,20,0.72)"
                strokeWidth="3"
                paintOrder="stroke"
                fontFamily="'IBM Plex Mono', monospace"
                fontSize="11"
                letterSpacing="1.2"
              >
                INTERCHANGE
              </text>
            </>
          )}
        </g>
      )}

      {currentPoint && (
        <g transform={`translate(${currentPoint[0]} ${currentPoint[1]})`}>
          <circle r={compact ? 10 : 17} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
          <g transform={`rotate(${(current?.heading ?? 0) * (180 / Math.PI)})`}>
            <path
              d={compact ? 'M0 -8 L5 6 L0 3 L-5 6 Z' : 'M0 -13 L8 10 L0 5 L-8 10 Z'}
              fill={compact ? '#ffba72' : '#fff5dc'}
              stroke="rgba(21,31,29,0.85)"
              strokeWidth="1.5"
            />
          </g>
        </g>
      )}

      {compact && (
        <text x="26" y="50" fill="rgba(227,244,236,0.5)" fontFamily="'IBM Plex Mono', monospace" fontSize="18" letterSpacing="3">
          N
        </text>
      )}
    </svg>
  );
}
